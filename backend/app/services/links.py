"""Proposal links: opaque token slugs + DB-backed usage counters.

architecture.md §8 — the token alone is never trusted for caps: every call
re-checks the DB row (revoked / expiry / remaining budget), and budget
consumption is a single atomic UPDATE so parallel requests can't overshoot.

The prospect URL carries the link's `token_jti` as bare hex (uuid4().hex, 32
chars) — short, unguessable, and stable for the life of the link. Auth is a
direct DB lookup on that column; no signature to decode.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal

import jwt

ALGO = "HS256"

ADMIN_TOKEN_TTL_HOURS = 12

# The one rail left on an access window. The old 72-hour ceiling is gone: a
# link may be minted for, or extended to, any point inside a year from now, so
# a shared URL can never quietly become permanent.
MAX_WINDOW_HOURS = 8760


class LinkAuthError(Exception):
    """code: invalid | revoked | expired | budget"""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


# ---------------------------------------------------------------- admin JWT


def mint_admin_token(secret: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": "admin",
        "typ": "admin",
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(hours=ADMIN_TOKEN_TTL_HOURS)).timestamp()),
    }
    return jwt.encode(payload, secret, algorithm=ALGO)


def verify_admin_token(token: str, secret: str) -> None:
    try:
        payload = jwt.decode(token, secret, algorithms=[ALGO])
    except jwt.PyJWTError as e:
        raise LinkAuthError("invalid", "invalid admin token") from e
    if payload.get("typ") != "admin":
        raise LinkAuthError("invalid", "not an admin token")


# ---------------------------------------------------------------- link token


def link_token(link: dict) -> str:
    """The link's opaque URL slug: its token_jti as bare hex (uuid4().hex)."""
    jti = link["token_jti"]
    return jti.hex if isinstance(jti, uuid.UUID) else uuid.UUID(str(jti)).hex


# ---------------------------------------------------------------- DB access


async def create_link(
    conn,
    *,
    label: str,
    max_ingestions: int,
    max_queries: int,
    expires_in_hours: int,
) -> dict:
    expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=expires_in_hours)
    cur = await conn.execute(
        """
        INSERT INTO proposal_link (label, max_ingestions, max_queries, expires_at)
        VALUES (%s, %s, %s, %s)
        RETURNING *
        """,
        (label, max_ingestions, max_queries, expires_at),
    )
    link = await cur.fetchone()
    await log_access_event(
        conn,
        link["id"],
        "minted",
        note=f"{expires_in_hours} h window",
        expires_after=link["expires_at"],
    )
    return link


async def extend_link(
    conn,
    link_id,
    *,
    expires_at: dt.datetime,
    top_up_queries: int | None = None,
    note: str = "",
) -> dict | None:
    """Move a link's expiry out (reviving an expired one) and optionally raise
    its question cap. Returns the updated row, or None when the link is gone.

    Extending never mints a new token, so a URL already shared with a client
    keeps working — which is the whole point of the feature.
    """
    cur = await conn.execute(
        "SELECT expires_at FROM proposal_link WHERE id = %s", (link_id,)
    )
    before = await cur.fetchone()
    if before is None:
        return None

    cur = await conn.execute(
        """
        UPDATE proposal_link
        SET expires_at  = %s,
            max_queries = GREATEST(max_queries, COALESCE(%s, max_queries)),
            revoked     = false
        WHERE id = %s
        RETURNING *
        """,
        (expires_at, top_up_queries, link_id),
    )
    link = await cur.fetchone()
    await log_access_event(
        conn,
        link_id,
        "extended",
        note=note,
        expires_before=before["expires_at"],
        expires_after=expires_at,
    )
    return link


async def log_access_event(
    conn,
    link_id,
    kind: str,
    *,
    actor: str = "admin",
    note: str = "",
    expires_before: dt.datetime | None = None,
    expires_after: dt.datetime | None = None,
) -> None:
    await conn.execute(
        """
        INSERT INTO access_event
            (link_id, kind, actor, note, expires_before, expires_after)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (link_id, kind, actor, note, expires_before, expires_after),
    )


async def list_access_events(conn, link_id) -> list[dict]:
    cur = await conn.execute(
        """
        SELECT kind, actor, note, expires_before, expires_after, ts
        FROM access_event WHERE link_id = %s ORDER BY ts DESC LIMIT 50
        """,
        (link_id,),
    )
    return await cur.fetchall()


async def load_link_for_token(
    conn, token: str, *, allow_inactive: bool = False
) -> dict:
    """Look up the link by its opaque token slug, then validate the DB row.
    With allow_inactive=True (info endpoint) revoked/expired rows are returned
    so the UI can show the right blocked screen."""
    try:
        jti = uuid.UUID(hex=token)
    except (ValueError, AttributeError, TypeError) as e:
        raise LinkAuthError("invalid", "invalid link token") from e
    cur = await conn.execute("SELECT * FROM proposal_link WHERE token_jti = %s", (jti,))
    link = await cur.fetchone()
    if link is None:
        raise LinkAuthError("invalid", "unknown link")
    if not allow_inactive:
        if link["revoked"]:
            raise LinkAuthError("revoked", "link revoked")
        if link["expires_at"] < dt.datetime.now(dt.timezone.utc):
            raise LinkAuthError("expired", "link expired")
    return link


async def consume_budget(
    conn, link_id: str, kind: Literal["ingestion", "query"]
) -> dict | None:
    """Atomically authorize + count one action. Returns the updated row, or
    None when the cap is hit / link no longer usable (§8)."""
    field = "used_ingestions" if kind == "ingestion" else "used_queries"
    cap = "max_ingestions" if kind == "ingestion" else "max_queries"
    cur = await conn.execute(
        f"""
        UPDATE proposal_link
        SET {field} = {field} + 1
        WHERE id = %s
          AND NOT revoked
          AND expires_at > now()
          AND {field} < {cap}
        RETURNING *
        """,
        (link_id,),
    )
    return await cur.fetchone()


async def revoke_link(conn, link_id: str) -> None:
    await conn.execute(
        "UPDATE proposal_link SET revoked = true WHERE id = %s", (link_id,)
    )
    await log_access_event(conn, link_id, "revoked")


async def reinstate_link(conn, link_id: str) -> dict | None:
    """Undo a revoke without touching the expiry window."""
    cur = await conn.execute(
        "UPDATE proposal_link SET revoked = false WHERE id = %s RETURNING *",
        (link_id,),
    )
    link = await cur.fetchone()
    if link is not None:
        await log_access_event(conn, link_id, "reinstated")
    return link


async def list_links(conn) -> list[dict]:
    cur = await conn.execute("SELECT * FROM proposal_link ORDER BY created_at DESC")
    return await cur.fetchall()


def link_public(link: dict) -> dict:
    """Shape a proposal_link row for the admin UI (types.ts ProposalLink)."""
    return {
        "id": str(link["id"]),
        "label": link["label"],
        "url": f"/p/{link_token(link)}",
        "createdAt": link["created_at"].isoformat(),
        "expiresAt": link["expires_at"].isoformat(),
        "maxIngestions": link["max_ingestions"],
        "usedIngestions": link["used_ingestions"],
        "maxQueries": link["max_queries"],
        "usedQueries": link["used_queries"],
        "revoked": link["revoked"],
    }


def link_info(link: dict, token: str) -> dict:
    """Shape for the prospect landing page (types.ts LinkInfo)."""
    return {
        "token": token,
        "label": link["label"],
        "expiresAt": link["expires_at"].isoformat(),
        "maxIngestions": link["max_ingestions"],
        "usedIngestions": link["used_ingestions"],
        "maxQueries": link["max_queries"],
        "usedQueries": link["used_queries"],
        "revoked": link["revoked"],
    }
