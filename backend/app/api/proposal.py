"""Prospect-facing endpoints: link info, warm-up, default corpus, source docs."""

from __future__ import annotations

import asyncio
import time
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..core.parsing import kind_of
from ..services.links import MAX_WINDOW_HOURS, link_info, log_access_event
from .deps import bearer_or_query_token, require_link

router = APIRouter()

# /api/warm rate limit (§8): once per link per interval is plenty — it only
# needs to fire when a prospect opens the landing page.
_WARM_INTERVAL_S = 10
_warm_last: dict[str, float] = {}


@router.get("/api/proposal/info")
async def proposal_info(request: Request):
    # allow_inactive: revoked/expired links still return their metadata so the
    # UI can show the right blocked screen (enforcement happens on actions).
    link = await require_link(request, allow_inactive=True)
    info = link_info(link, bearer_or_query_token(request))
    async with request.app.state.pool.connection() as conn:
        cur = await conn.execute(
            "SELECT 1 FROM extension_request "
            "WHERE link_id = %s AND status = 'pending' LIMIT 1",
            (link["id"],),
        )
        info["extensionRequested"] = await cur.fetchone() is not None
    return info


class ExtensionRequestBody(BaseModel):
    hours: int = Field(ge=1, le=MAX_WINDOW_HOURS)
    note: str = Field(default="", max_length=500)


@router.post("/api/proposal/extension-request")
async def request_extension(body: ExtensionRequestBody, request: Request):
    """Asked for from the blocked screen, granted (or not) in the admin portal.

    allow_inactive: the whole point is that the caller is locked out, so an
    expired or revoked link must still be able to send this.
    """
    link = await require_link(request, allow_inactive=True)
    async with request.app.state.pool.connection() as conn:
        cur = await conn.execute(
            "SELECT 1 FROM extension_request "
            "WHERE link_id = %s AND status = 'pending' LIMIT 1",
            (link["id"],),
        )
        if await cur.fetchone() is not None:
            return {"status": "pending"}  # one open request per link is enough
        await conn.execute(
            "INSERT INTO extension_request (link_id, hours, note) VALUES (%s, %s, %s)",
            (link["id"], body.hours, body.note.strip()),
        )
        await log_access_event(
            conn,
            link["id"],
            "requested",
            actor="client",
            note=body.note.strip() or f"{body.hours} h",
        )
    return {"status": "pending"}


@router.post("/api/warm")
async def warm(request: Request):
    """Predictive warm-up on link open (§3.3, §4.1): heat the embedder, DB
    pool, and Gemini client while the prospect is still reading the page."""
    link = await require_link(request)
    st = request.app.state

    lid = str(link["id"])
    now = time.monotonic()
    if now - _warm_last.get(lid, 0) < _WARM_INTERVAL_S:
        return {"status": "ready"}
    _warm_last[lid] = now

    async with st.pool.connection() as conn:  # DB pool is hot
        await conn.execute("SELECT 1")
    st.llm.warm()  # client construction (TLS setup happens lazily on 1st call)
    if st.settings.embedding.warm != "lazy":
        try:
            await asyncio.wait_for(st.mm.ensure_warm(), timeout=120)
        except asyncio.TimeoutError:
            raise HTTPException(503, "model warm-up timed out")
    return {"status": "ready"}


@router.get("/api/corpus/default")
async def default_corpus(request: Request):
    st = request.app.state
    async with st.pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT id, filename FROM document
            WHERE corpus = 'default' AND status = 'ready'
            ORDER BY filename
            """
        )
        rows = await cur.fetchall()
    return [
        {"docId": str(r["id"]), "filename": r["filename"], "kind": kind_of(r["filename"])}
        for r in rows
    ]


@router.get("/api/source/{doc_id}")
async def source_doc(doc_id: str, request: Request):
    """Parsed page texts for the viewer. Default-corpus docs are public;
    user docs require the owning link's token (§3.4, §8)."""
    st = request.app.state
    try:
        doc_uuid = uuid.UUID(doc_id)
    except ValueError:
        raise HTTPException(404, "document not found")
    async with st.pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, link_id, corpus, filename, status FROM document WHERE id = %s",
            (doc_uuid,),
        )
        doc = await cur.fetchone()
        if doc is None or doc["status"] != "ready":
            raise HTTPException(404, "document not found")

        if doc["corpus"] != "default":
            link = await require_link(request)
            if link["id"] != doc["link_id"]:
                raise HTTPException(403, "document belongs to another workspace")

        cur = await conn.execute(
            "SELECT page, text FROM document_page WHERE document_id = %s ORDER BY page",
            (doc_id,),
        )
        pages = await cur.fetchall()

    return {
        "docId": str(doc["id"]),
        "filename": doc["filename"],
        "kind": kind_of(doc["filename"]),
        "pages": [{"page": p["page"], "text": p["text"]} for p in pages],
    }
