"""RAG query pipeline (architecture.md §3.2): embed-query → retrieve →
generate, streamed as events matching frontend/src/api/types.ts QueryEvent.

Grounding guarantee: chunks below retrieval.score_threshold are discarded; if
nothing survives, a refusal is streamed instead of calling the LLM. The system
prompt additionally constrains Gemini to the retrieved passages with [n]
citations.
"""

from __future__ import annotations

import asyncio
import re
import time
from typing import AsyncIterator

from ..config import Settings
from .embedder import QueryEmbeddingCache
from .llm import GeminiLLM, StreamResult, Usage
from .model_manager import ModelManager
from .vectorstore import ScoredChunk, search

REFUSAL_ANSWER = (
    "The documents in this workspace do not contain enough information to answer "
    "that question, so I will not guess. Answers here are strictly grounded in the "
    "indexed corpus — try a different question, or upload documents that cover this topic."
)

SYSTEM_PROMPT = """You are the answer engine of an enterprise knowledge platform. \
Answer the user's question using ONLY the numbered source passages provided.

Rules:
- Every factual claim must be supported by the passages; cite the supporting \
passage inline with its bracketed number, e.g. [1] or [2], right after the claim.
- Use only the passage numbers that actually support the claim; never invent numbers.
- If the passages do not contain the information needed, say so plainly and do not guess.
- Be concise and direct: a short paragraph or two, no headers, no bullet lists \
unless the user asks for a list.
- Do not mention the words "passage", "source" or "context" in the answer text; \
just answer with citations."""

FOLLOWUP_PROMPT = """Based on the source passages below, suggest {count} short follow-up \
questions that these documents can definitely answer. They should be natural next \
questions after the exchange shown. Return exactly {count} questions, one per line, \
no numbering or bullets.

Previous question: {question}
Previous answer: {answer}

Source passages:
{passages}"""

_SNIPPET_LEN = 220


def _snippet(text: str) -> str:
    flat = " ".join(text.split())
    return flat[: _SNIPPET_LEN - 1] + "…" if len(flat) > _SNIPPET_LEN else flat


def _passages_block(hits: list[ScoredChunk]) -> str:
    parts = []
    for i, h in enumerate(hits, start=1):
        where = f"{h.filename}" + (f", page {h.page}" if h.page else "")
        parts.append(f"[{i}] (from {where})\n{h.text}")
    return "\n\n".join(parts)


def _citations(hits: list[ScoredChunk]) -> list[dict]:
    return [
        {
            "id": i + 1,
            "docId": h.document_id,
            "filename": h.filename,
            "page": h.page,
            "charStart": h.char_start,
            "charEnd": h.char_end,
            "snippet": _snippet(h.text),
            "score": round(h.score, 4),
        }
        for i, h in enumerate(hits)
    ]


def _parse_followups(text: str, count: int) -> list[str]:
    out = []
    for line in text.splitlines():
        line = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", line).strip()
        if line.endswith("?") and len(line) > 8:
            out.append(line)
    return out[:count]


async def query_stream(
    pool,
    mm: ModelManager,
    llm: GeminiLLM,
    settings: Settings,
    query_cache: QueryEmbeddingCache,
    *,
    link_id: str,
    corpus: str,
    question: str,
) -> AsyncIterator[dict]:
    t_start = time.perf_counter()
    retrieval = settings.retrieval

    # ---- embed-query ----------------------------------------------------
    yield {"type": "stage", "stage": "embed-query", "status": "started"}
    t0 = time.perf_counter()
    cache_key = question.strip().lower()
    vec = query_cache.get(cache_key)
    cached = vec is not None
    if vec is None:
        async with mm.lease() as embedder:
            vec = await asyncio.to_thread(embedder.embed_query, question)
        query_cache.put(cache_key, vec)
    embed_ms = int((time.perf_counter() - t0) * 1000)
    yield {
        "type": "stage", "stage": "embed-query", "status": "completed",
        "durationMs": embed_ms,
        "info": f"{len(vec)}-dim" + (" · cached" if cached else ""),
    }

    # ---- retrieve --------------------------------------------------------
    yield {"type": "stage", "stage": "retrieve", "status": "started"}
    t0 = time.perf_counter()
    namespace_link = link_id if corpus == "user" else None
    async with pool.connection() as conn:
        rows = await search(
            conn,
            link_id=namespace_link,
            corpus=corpus,
            query_vec=vec,
            k=retrieval.top_k,
        )
    retrieval_ms = int((time.perf_counter() - t0) * 1000)
    hits = [r for r in rows if r.score >= retrieval.score_threshold]
    yield {
        "type": "stage", "stage": "retrieve", "status": "completed",
        "durationMs": retrieval_ms,
        "info": f"top-{len(hits)}, threshold {retrieval.score_threshold:.2f}",
    }

    citations = _citations(hits)
    grounded = len(hits) > 0
    yield {"type": "sources", "citations": citations}
    yield {"type": "grounded", "grounded": grounded}

    # ---- generate ---------------------------------------------------------
    yield {"type": "stage", "stage": "generate", "status": "started"}
    t_gen = time.perf_counter()
    ttft_ms = 0
    answer = ""
    usage = Usage()

    if not grounded:
        # grounding guarantee: no sources above threshold → refuse, no LLM call
        answer = REFUSAL_ANSWER
        ttft_ms = int((time.perf_counter() - t_start) * 1000)
        for word in answer.split(" "):
            yield {"type": "token", "text": word + " "}
    else:
        passages = _passages_block(hits)
        messages = [
            ("system", SYSTEM_PROMPT),
            ("human", f"Source passages:\n\n{passages}\n\nQuestion: {question}"),
        ]
        result = StreamResult()
        try:
            first = True
            async for delta in llm.stream(messages, result):
                if first:
                    ttft_ms = int((time.perf_counter() - t_start) * 1000)
                    first = False
                yield {"type": "token", "text": delta}
            answer, usage = result.text, result.usage
        except Exception as e:
            yield {"type": "error", "message": f"answer generation failed: {e}"}
            return
    gen_ms = int((time.perf_counter() - t_gen) * 1000)
    yield {"type": "stage", "stage": "generate", "status": "completed", "durationMs": gen_ms}

    # ---- follow-ups (second short LLM call, §3.2 step 5) -------------------
    followups: list[str] = []
    if settings.follow_ups.enabled and grounded:
        try:
            prompt = FOLLOWUP_PROMPT.format(
                count=settings.follow_ups.count,
                question=question,
                answer=answer[:2000],
                passages=_passages_block(hits)[:6000],
            )
            text, fu_usage = await llm.complete([("human", prompt)])
            followups = _parse_followups(text, settings.follow_ups.count)
            usage.input_tokens += fu_usage.input_tokens
            usage.output_tokens += fu_usage.output_tokens
        except Exception:
            followups = []
    if followups:
        yield {"type": "followups", "questions": followups}

    # ---- persist + done ----------------------------------------------------
    total_ms = int((time.perf_counter() - t_start) * 1000)
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO query_log
                (link_id, corpus, question, answer, grounded, retrieved_chunk_ids,
                 retrieved_scores, kept_chunks,
                 retrieval_ms, ttft_ms, total_ms, input_tokens, output_tokens,
                 est_cost, model)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                link_id, corpus, question, answer, grounded,
                # every hit the search returned, closest first — the ones below
                # the floor are what the admin drill-down shows as discarded
                [r.chunk_id for r in rows],
                [round(r.score, 4) for r in rows],
                len(hits),
                retrieval_ms, ttft_ms, total_ms,
                usage.input_tokens, usage.output_tokens,
                usage.est_cost_usd, llm.model if grounded else "",
            ),
        )
        query_id = str((await cur.fetchone())["id"])

    yield {
        "type": "done",
        "queryId": query_id,
        "stats": {
            "retrievalMs": retrieval_ms,
            "ttftMs": ttft_ms,
            "totalMs": total_ms,
            "inputTokens": usage.input_tokens,
            "outputTokens": usage.output_tokens,
            "model": llm.model,
            "estCostUsd": usage.est_cost_usd,
        },
    }
