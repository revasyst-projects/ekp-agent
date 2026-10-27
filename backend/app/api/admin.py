"""Admin portal endpoints: login, proposal-link management, usage analytics.

The analytics side answers three questions the old single dashboard could not:
how is the platform doing overall (``/dashboard``), what happened on one link
(``/links/{id}``), and how was one answer actually produced
(``/queries/{id}`` — the retrieved chunks, their scores and which ones cleared
the grounding floor).
"""

from __future__ import annotations

import datetime as dt
import hmac
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..services import links as link_svc
from .deps import require_admin

router = APIRouter()


def _uuid_or_404(value: str, what: str = "link") -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(404, f"{what} not found")


class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/api/admin/login")
async def login(body: LoginBody, request: Request):
    sec = request.app.state.settings.secrets
    if not sec.admin_username or not sec.admin_password:
        raise HTTPException(503, "admin credentials are not configured")
    ok = hmac.compare_digest(body.username, sec.admin_username) & hmac.compare_digest(
        body.password, sec.admin_password
    )
    if not ok:
        raise HTTPException(401, "invalid credentials")
    return {"token": link_svc.mint_admin_token(sec.jwt_secret)}


# ---------------------------------------------------------------- links


class CreateLinkBody(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    maxIngestions: int = Field(ge=1, le=100)
    maxQueries: int = Field(ge=1, le=1000)
    expiresInHours: int = Field(ge=1, le=link_svc.MAX_WINDOW_HOURS)


class ExtendLinkBody(BaseModel):
    """Either a span in hours or an absolute instant, never both.

    `anchor` decides what a span is added to: "now" reopens an expired link for
    the full span from this moment, "current" continues from the old expiry.
    """

    hours: int | None = Field(default=None, ge=1, le=link_svc.MAX_WINDOW_HOURS)
    expiresAt: dt.datetime | None = None
    anchor: str = Field(default="now", pattern="^(now|current)$")
    topUpQueries: int | None = Field(default=None, ge=1, le=1000)
    note: str = Field(default="", max_length=500)
    requestId: str | None = None


@router.get("/api/admin/links", dependencies=[Depends(require_admin)])
async def list_links(request: Request):
    st = request.app.state
    async with st.pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT pl.*,
                   (SELECT max(q.ts) FROM query_log q WHERE q.link_id = pl.id)
                       AS last_activity_at,
                   (SELECT count(*) FROM document d
                    WHERE d.link_id = pl.id AND d.corpus = 'user')::int
                       AS document_count,
                   (SELECT er.hours FROM extension_request er
                    WHERE er.link_id = pl.id AND er.status = 'pending'
                    ORDER BY er.ts DESC LIMIT 1) AS pending_hours,
                   (SELECT er.note FROM extension_request er
                    WHERE er.link_id = pl.id AND er.status = 'pending'
                    ORDER BY er.ts DESC LIMIT 1) AS pending_note,
                   (SELECT er.id::text FROM extension_request er
                    WHERE er.link_id = pl.id AND er.status = 'pending'
                    ORDER BY er.ts DESC LIMIT 1) AS pending_id
            FROM proposal_link pl
            ORDER BY pl.created_at DESC
            """
        )
        rows = await cur.fetchall()
    return [_link_row(r) for r in rows]


def _link_row(r: dict) -> dict:
    out = link_svc.link_public(r)
    out["documentCount"] = r.get("document_count", 0)
    out["lastActivityAt"] = (
        r["last_activity_at"].isoformat() if r.get("last_activity_at") else None
    )
    out["pendingExtension"] = (
        {
            "id": r["pending_id"],
            "hours": r["pending_hours"],
            "note": r["pending_note"] or "",
        }
        if r.get("pending_id")
        else None
    )
    return out


@router.post("/api/admin/links", dependencies=[Depends(require_admin)])
async def create_link(body: CreateLinkBody, request: Request):
    st = request.app.state
    async with st.pool.connection() as conn:
        row = await link_svc.create_link(
            conn,
            label=body.label.strip(),
            max_ingestions=body.maxIngestions,
            max_queries=body.maxQueries,
            expires_in_hours=body.expiresInHours,
        )
    return link_svc.link_public(row)


@router.post("/api/admin/links/{link_id}/revoke", dependencies=[Depends(require_admin)])
async def revoke(link_id: str, request: Request):
    lid = _uuid_or_404(link_id)
    async with request.app.state.pool.connection() as conn:
        await link_svc.revoke_link(conn, lid)
    return {"status": "ok"}


@router.post(
    "/api/admin/links/{link_id}/reinstate", dependencies=[Depends(require_admin)]
)
async def reinstate(link_id: str, request: Request):
    lid = _uuid_or_404(link_id)
    async with request.app.state.pool.connection() as conn:
        row = await link_svc.reinstate_link(conn, lid)
    if row is None:
        raise HTTPException(404, "link not found")
    return link_svc.link_public(row)


@router.post("/api/admin/links/{link_id}/extend", dependencies=[Depends(require_admin)])
async def extend(link_id: str, body: ExtendLinkBody, request: Request):
    """Push a link's expiry out — including one that has already lapsed."""
    lid = _uuid_or_404(link_id)
    now = dt.datetime.now(dt.timezone.utc)
    ceiling = now + dt.timedelta(hours=link_svc.MAX_WINDOW_HOURS)

    async with request.app.state.pool.connection() as conn:
        cur = await conn.execute(
            "SELECT expires_at FROM proposal_link WHERE id = %s", (lid,)
        )
        current = await cur.fetchone()
        if current is None:
            raise HTTPException(404, "link not found")

        if body.expiresAt is not None:
            expires_at = body.expiresAt
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=dt.timezone.utc)
        elif body.hours is not None:
            base = now
            if body.anchor == "current":
                base = max(now, current["expires_at"])
            expires_at = base + dt.timedelta(hours=body.hours)
        else:
            raise HTTPException(400, "pass either hours or expiresAt")

        if expires_at <= now:
            raise HTTPException(400, "the new expiry is already in the past")
        if expires_at > ceiling:
            raise HTTPException(
                400,
                f"an access window cannot run past {ceiling.date().isoformat()} "
                f"({link_svc.MAX_WINDOW_HOURS // 24} days from now)",
            )

        row = await link_svc.extend_link(
            conn,
            lid,
            expires_at=expires_at,
            top_up_queries=body.topUpQueries,
            note=body.note.strip(),
        )
        if body.requestId:
            await conn.execute(
                "UPDATE extension_request SET status = 'granted' WHERE id = %s",
                (_uuid_or_404(body.requestId, "request"),),
            )
    return link_svc.link_public(row)


@router.post(
    "/api/admin/requests/{request_id}/decline", dependencies=[Depends(require_admin)]
)
async def decline_request(request_id: str, request: Request):
    rid = _uuid_or_404(request_id, "request")
    async with request.app.state.pool.connection() as conn:
        cur = await conn.execute(
            "UPDATE extension_request SET status = 'declined' WHERE id = %s "
            "RETURNING link_id",
            (rid,),
        )
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(404, "request not found")
        await link_svc.log_access_event(conn, row["link_id"], "declined")
    return {"status": "ok"}


@router.get("/api/admin/links/{link_id}", dependencies=[Depends(require_admin)])
async def link_detail(link_id: str, request: Request):
    """One link: its counters, the documents it ingested, the whole
    conversation, and the audit trail of its access window."""
    lid = _uuid_or_404(link_id)
    async with request.app.state.pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT pl.*,
                   (SELECT max(q.ts) FROM query_log q WHERE q.link_id = pl.id)
                       AS last_activity_at,
                   (SELECT count(*) FROM document d
                    WHERE d.link_id = pl.id AND d.corpus = 'user')::int
                       AS document_count,
                   (SELECT er.hours FROM extension_request er
                    WHERE er.link_id = pl.id AND er.status = 'pending'
                    ORDER BY er.ts DESC LIMIT 1) AS pending_hours,
                   (SELECT er.note FROM extension_request er
                    WHERE er.link_id = pl.id AND er.status = 'pending'
                    ORDER BY er.ts DESC LIMIT 1) AS pending_note,
                   (SELECT er.id::text FROM extension_request er
                    WHERE er.link_id = pl.id AND er.status = 'pending'
                    ORDER BY er.ts DESC LIMIT 1) AS pending_id
            FROM proposal_link pl WHERE pl.id = %s
            """,
            (lid,),
        )
        link = await cur.fetchone()
        if link is None:
            raise HTTPException(404, "link not found")

        cur = await conn.execute(
            """
            SELECT count(*)::int                                        AS queries,
                   count(*) FILTER (WHERE grounded)::int                AS grounded,
                   coalesce(sum(input_tokens + output_tokens), 0)::int  AS tokens,
                   coalesce(sum(est_cost), 0)                           AS est_cost,
                   coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY total_ms), 0)
                                                                        AS p50_ms,
                   coalesce(percentile_cont(0.9) WITHIN GROUP (ORDER BY total_ms), 0)
                                                                        AS p90_ms
            FROM query_log WHERE link_id = %s
            """,
            (lid,),
        )
        totals = await cur.fetchone()

        cur = await conn.execute(
            """
            SELECT d.id::text AS id, d.filename, d.size_bytes, d.page_count,
                   d.status, d.ingested_at,
                   (SELECT count(*) FROM chunk c WHERE c.document_id = d.id)::int
                       AS chunk_count,
                   coalesce((SELECT sum(ie.duration_ms) FROM ingestion_event ie
                             WHERE ie.document_id = d.id), 0)::int AS total_ms
            FROM document d
            WHERE d.link_id = %s AND d.corpus = 'user'
            ORDER BY d.ingested_at
            """,
            (lid,),
        )
        documents = await cur.fetchall()

        cur = await conn.execute(_CONVERSATION_SQL, (lid,))
        conversation = await cur.fetchall()

        events = await link_svc.list_access_events(conn, lid)

    return {
        "link": _link_row(link),
        "totals": {
            "queries": totals["queries"],
            "grounded": totals["grounded"],
            "tokens": totals["tokens"],
            "estCostUsd": float(totals["est_cost"]),
            "p50Ms": int(totals["p50_ms"]),
            "p90Ms": int(totals["p90_ms"]),
        },
        "documents": [
            {
                "docId": d["id"],
                "filename": d["filename"],
                "sizeBytes": d["size_bytes"],
                "pageCount": d["page_count"],
                "chunkCount": d["chunk_count"],
                "totalMs": d["total_ms"],
                "status": d["status"],
                "ingestedAt": d["ingested_at"].isoformat(),
            }
            for d in documents
        ],
        "conversation": [_query_row(q) for q in conversation],
        "accessEvents": [
            {
                "kind": e["kind"],
                "actor": e["actor"],
                "note": e["note"],
                "expiresBefore": e["expires_before"].isoformat()
                if e["expires_before"]
                else None,
                "expiresAfter": e["expires_after"].isoformat()
                if e["expires_after"]
                else None,
                "ts": e["ts"].isoformat(),
            }
            for e in events
        ],
    }


@router.get("/api/admin/links/{link_id}/events", dependencies=[Depends(require_admin)])
async def link_events(link_id: str, request: Request):
    lid = _uuid_or_404(link_id)
    async with request.app.state.pool.connection() as conn:
        events = await link_svc.list_access_events(conn, lid)
    return [
        {
            "kind": e["kind"],
            "actor": e["actor"],
            "note": e["note"],
            "expiresBefore": e["expires_before"].isoformat()
            if e["expires_before"]
            else None,
            "expiresAfter": e["expires_after"].isoformat()
            if e["expires_after"]
            else None,
            "ts": e["ts"].isoformat(),
        }
        for e in events
    ]


# ---------------------------------------------------------------- queries

_QUERY_COLUMNS = """
    q.id::text AS id, q.ts, q.question, q.answer, q.grounded, q.total_ms,
    q.input_tokens, q.output_tokens, q.est_cost, q.model, q.corpus,
    q.link_id::text AS link_id,
    coalesce(pl.label, '—') AS link_label,
    fb.verdict, fb.reason
"""

_CONVERSATION_SQL = f"""
    SELECT {_QUERY_COLUMNS}
    FROM query_log q
    LEFT JOIN proposal_link pl ON pl.id = q.link_id
    LEFT JOIN LATERAL (
        SELECT f.verdict, f.reason FROM feedback f
        WHERE f.query_log_id = q.id ORDER BY f.ts DESC LIMIT 1
    ) fb ON true
    WHERE q.link_id = %s
    ORDER BY q.ts DESC
"""


def _query_row(q: dict) -> dict:
    return {
        "queryId": q["id"],
        "ts": q["ts"].isoformat(),
        "linkId": q["link_id"],
        "linkLabel": q["link_label"],
        "corpus": q["corpus"],
        "question": q["question"],
        "answer": q["answer"],
        "grounded": q["grounded"],
        "totalMs": q["total_ms"],
        "tokens": q["input_tokens"] + q["output_tokens"],
        "estCostUsd": float(q["est_cost"]),
        "model": q["model"],
        "feedback": q["verdict"],
        "feedbackReason": q["reason"],
    }


@router.get("/api/admin/queries", dependencies=[Depends(require_admin)])
async def list_queries(
    request: Request,
    linkId: str | None = None,
    days: int = 14,
    grounded: bool | None = None,
    feedback: str | None = None,
    q: str | None = None,
    limit: int = 100,
):
    """The searchable question list behind the analytics page."""
    days = max(1, min(days, 365))
    limit = max(1, min(limit, 500))
    where = ["q.ts > now() - make_interval(days => %s)"]
    args: list = [days]
    if linkId:
        where.append("q.link_id = %s")
        args.append(_uuid_or_404(linkId))
    if grounded is not None:
        where.append("q.grounded = %s")
        args.append(grounded)
    if feedback in ("like", "dislike"):
        where.append("fb.verdict = %s")
        args.append(feedback)
    if q:
        where.append("(q.question ILIKE %s OR q.answer ILIKE %s)")
        args.extend([f"%{q}%", f"%{q}%"])
    args.append(limit)

    sql = f"""
        SELECT {_QUERY_COLUMNS}
        FROM query_log q
        LEFT JOIN proposal_link pl ON pl.id = q.link_id
        LEFT JOIN LATERAL (
            SELECT f.verdict, f.reason FROM feedback f
            WHERE f.query_log_id = q.id ORDER BY f.ts DESC LIMIT 1
        ) fb ON true
        WHERE {' AND '.join(where)}
        ORDER BY q.ts DESC
        LIMIT %s
    """
    async with request.app.state.pool.connection() as conn:
        cur = await conn.execute(sql, tuple(args))
        rows = await cur.fetchall()
    return [_query_row(r) for r in rows]


@router.get("/api/admin/queries/{query_id}", dependencies=[Depends(require_admin)])
async def query_detail(query_id: str, request: Request):
    """One answer, inspected: the chunks retrieval returned, their similarity
    to the question, and which ones cleared the grounding floor.

    `retrieved_chunk_ids` and `retrieved_scores` are written in retrieval
    order (closest first) and cover every hit the search returned, so the ones
    that fell below the floor are shown here as discarded rather than hidden.
    """
    qid = _uuid_or_404(query_id, "query")
    floor = request.app.state.settings.retrieval.score_threshold
    async with request.app.state.pool.connection() as conn:
        cur = await conn.execute(
            f"""
            SELECT {_QUERY_COLUMNS}, q.retrieved_chunk_ids,
                   q.retrieved_scores, q.kept_chunks, q.retrieval_ms, q.ttft_ms
            FROM query_log q
            LEFT JOIN proposal_link pl ON pl.id = q.link_id
            LEFT JOIN LATERAL (
                SELECT f.verdict, f.reason FROM feedback f
                WHERE f.query_log_id = q.id ORDER BY f.ts DESC LIMIT 1
            ) fb ON true
            WHERE q.id = %s
            """,
            (qid,),
        )
        row = await cur.fetchone()
        if row is None:
            raise HTTPException(404, "query not found")

        chunk_ids = list(row["retrieved_chunk_ids"] or [])
        scores = list(row["retrieved_scores"] or [])
        kept = row["kept_chunks"]
        chunks: list[dict] = []
        if chunk_ids:
            cur = await conn.execute(
                """
                SELECT c.id, c.ordinal, c.page, c.char_start, c.char_end,
                       c.text, c.token_count,
                       d.id::text AS doc_id, d.filename,
                       (SELECT count(*) FROM chunk c2
                        WHERE c2.document_id = d.id)::int AS doc_chunks
                FROM chunk c JOIN document d ON d.id = c.document_id
                WHERE c.id = ANY(%s)
                """,
                (chunk_ids,),
            )
            by_id = {c["id"]: c for c in await cur.fetchall()}
            # retrieval order is the stored array's order
            chunks = [by_id[i] for i in chunk_ids if i in by_id]

        cur = await conn.execute(
            """
            SELECT count(*)::int AS n FROM query_log
            WHERE question = (SELECT question FROM query_log WHERE id = %s)
            """,
            (qid,),
        )
        asked = await cur.fetchone()

    detail = _query_row(row)
    detail.update(
        {
            "retrievalMs": row["retrieval_ms"],
            "ttftMs": row["ttft_ms"],
            "inputTokens": row["input_tokens"],
            "outputTokens": row["output_tokens"],
            "similarityFloor": floor,
            "retrievedCount": len(chunk_ids),
            "keptCount": kept,
            "askedTimes": asked["n"],
            "chunks": [
                {
                    "chunkId": c["id"],
                    "docId": c["doc_id"],
                    "filename": c["filename"],
                    "ordinal": c["ordinal"],
                    "docChunks": c["doc_chunks"],
                    "page": c["page"],
                    "charStart": c["char_start"],
                    "charEnd": c["char_end"],
                    "tokenCount": c["token_count"],
                    "snippet": c["text"][:400],
                    # retrieval order is by distance, so rank 1 is the closest
                    "rank": i + 1,
                    "score": scores[i] if i < len(scores) else None,
                    "used": i < kept,
                }
                for i, c in enumerate(chunks)
            ],
        }
    )
    return detail


# ---------------------------------------------------------------- dashboard


@router.get("/api/admin/dashboard", dependencies=[Depends(require_admin)])
async def dashboard(request: Request, days: int = 14, linkId: str | None = None):
    """Headline numbers, the daily volume series, and the two lists worth
    acting on: what the corpus could not answer, and what earned a thumbs
    down."""
    days = max(1, min(days, 365))
    link_filter = ""
    link_args: tuple = ()
    if linkId:
        link_filter = "AND q.link_id = %s"
        link_args = (_uuid_or_404(linkId),)

    st = request.app.state
    async with st.pool.connection() as conn:
        cur = await conn.execute(
            f"""
            SELECT
              count(*)::int                                       AS queries,
              count(*) FILTER (WHERE q.grounded)::int             AS grounded,
              coalesce(sum(q.input_tokens + q.output_tokens), 0)::int AS tokens,
              coalesce(sum(q.est_cost), 0)                        AS est_cost,
              coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY q.total_ms), 0)
                                                                  AS p50_ms,
              coalesce(percentile_cont(0.9) WITHIN GROUP (ORDER BY q.total_ms), 0)
                                                                  AS p90_ms,
              coalesce(percentile_cont(0.99) WITHIN GROUP (ORDER BY q.total_ms), 0)
                                                                  AS p99_ms
            FROM query_log q
            WHERE q.ts > now() - make_interval(days => %s) {link_filter}
            """,
            (days, *link_args),
        )
        q_totals = await cur.fetchone()

        cur = await conn.execute(
            """
            SELECT
              (SELECT count(*) FROM proposal_link
               WHERE NOT revoked AND expires_at > now())            AS active_links,
              (SELECT count(*) FROM proposal_link
               WHERE NOT revoked AND expires_at > now()
                 AND expires_at < now() + interval '24 hours')      AS expiring_soon,
              (SELECT count(*) FROM proposal_link)                  AS total_links,
              (SELECT count(*) FROM extension_request
               WHERE status = 'pending')                            AS pending_requests,
              (SELECT count(*) FROM document WHERE corpus = 'user') AS ingestions,
              (SELECT coalesce(sum(c.token_count), 0) FROM chunk c
               JOIN document d ON d.id = c.document_id
               WHERE d.corpus = 'user')                             AS ingest_tokens,
              (SELECT count(*) FROM chunk c JOIN document d
               ON d.id = c.document_id WHERE d.corpus = 'user')     AS chunks,
              (SELECT count(*) FROM feedback WHERE verdict = 'like')    AS likes,
              (SELECT count(*) FROM feedback WHERE verdict = 'dislike') AS dislikes
            """
        )
        totals = await cur.fetchone()

        cur = await conn.execute(
            f"""
            SELECT d::date AS day,
                   count(q.id)::int AS n,
                   count(q.id) FILTER (WHERE NOT q.grounded)::int AS refused
            FROM generate_series(
                   date_trunc('day', now()) - make_interval(days => %s - 1),
                   date_trunc('day', now()),
                   interval '1 day'
                 ) d
            LEFT JOIN query_log q
              ON date_trunc('day', q.ts) = d {link_filter}
            GROUP BY d ORDER BY d
            """,
            (days, *link_args),
        )
        series = await cur.fetchall()

        cur = await conn.execute(
            f"""
            SELECT q.question, q.id::text AS id, q.ts, q.total_ms,
                   coalesce(pl.label, '—') AS link_label
            FROM query_log q
            LEFT JOIN proposal_link pl ON pl.id = q.link_id
            WHERE NOT q.grounded
              AND q.ts > now() - make_interval(days => %s) {link_filter}
            ORDER BY q.ts DESC LIMIT 20
            """,
            (days, *link_args),
        )
        refusals = await cur.fetchall()

        cur = await conn.execute(
            f"""
            SELECT q.id::text AS id, q.question, q.ts, f.reason,
                   coalesce(pl.label, '—') AS link_label
            FROM feedback f
            JOIN query_log q ON q.id = f.query_log_id
            LEFT JOIN proposal_link pl ON pl.id = q.link_id
            WHERE f.verdict = 'dislike'
              AND q.ts > now() - make_interval(days => %s) {link_filter}
            ORDER BY f.ts DESC LIMIT 20
            """,
            (days, *link_args),
        )
        complaints = await cur.fetchall()

    queries = q_totals["queries"]
    return {
        "days": days,
        "totals": {
            "activeLinks": totals["active_links"],
            "totalLinks": totals["total_links"],
            "expiringSoon": totals["expiring_soon"],
            "pendingRequests": totals["pending_requests"],
            "queries": queries,
            "grounded": q_totals["grounded"],
            "refused": queries - q_totals["grounded"],
            "groundedPct": round(q_totals["grounded"] / queries * 100) if queries else 0,
            "ingestions": totals["ingestions"],
            "chunks": totals["chunks"],
            "tokens": int(q_totals["tokens"]) + int(totals["ingest_tokens"]),
            "estCostUsd": float(q_totals["est_cost"]),
            "p50Ms": int(q_totals["p50_ms"]),
            "p90Ms": int(q_totals["p90_ms"]),
            "p99Ms": int(q_totals["p99_ms"]),
            "likes": totals["likes"],
            "dislikes": totals["dislikes"],
        },
        "series": [
            {"day": s["day"].isoformat(), "queries": s["n"], "refused": s["refused"]}
            for s in series
        ],
        "refusals": [
            {
                "queryId": r["id"],
                "question": r["question"],
                "linkLabel": r["link_label"],
                "ts": r["ts"].isoformat(),
                "totalMs": r["total_ms"],
            }
            for r in refusals
        ],
        "complaints": [
            {
                "queryId": c["id"],
                "question": c["question"],
                "linkLabel": c["link_label"],
                "reason": c["reason"],
                "ts": c["ts"].isoformat(),
            }
            for c in complaints
        ],
    }
