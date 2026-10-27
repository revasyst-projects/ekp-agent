import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { adminQueryDetail } from '../../api/client'
import type { QueryDetail, RetrievedChunk } from '../../api/types'
import { Badge, Card, InfoTip, Spinner } from '../../components/ui'
import { fmtCost, fmtDateTime, fmtMs, fmtNum, fmtPct } from '../../utils/format'

/**
 * One answer, inspected. The point of this page is the chunk list: every hit
 * retrieval returned, its score, and whether it cleared the floor — the only
 * way to tell a bad answer from a thin corpus.
 */
export default function QueryDetailPage() {
  const { queryId = '' } = useParams()
  const [data, setData] = useState<QueryDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminQueryDetail(queryId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the query'))
  }, [queryId])

  if (error) return <p className="py-16 text-center text-sm text-red-600">{error}</p>
  if (!data) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
        <Spinner /> Loading answer…
      </div>
    )
  }

  const discarded = data.retrievedCount - data.keptCount

  return (
    <div>
      {data.linkId ? (
        <Link to={`/admin/links/${data.linkId}`} className="text-xs text-indigo-600 hover:underline">
          ← {data.linkLabel}
        </Link>
      ) : (
        <Link to="/admin/dashboard" className="text-xs text-indigo-600 hover:underline">
          ← Analytics
        </Link>
      )}

      <header className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-96">
          <h1 className="text-xl font-semibold text-slate-900">{data.question}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={data.grounded ? 'indigo' : 'amber'}>
              {data.grounded ? 'answered' : 'declined'}
            </Badge>
            {data.feedback === 'like' && <Badge tone="green">👍 marked helpful</Badge>}
            {data.feedback === 'dislike' && <Badge tone="red">👎 thumbs down</Badge>}
            <span className="font-mono text-[11px] text-slate-500">
              {fmtDateTime(data.ts)} · {data.corpus} corpus · asked {data.askedTimes}×
            </span>
          </div>
        </div>
      </header>

      <div className="mt-5 flex flex-wrap gap-4">
        <div className="flex min-w-0 flex-[999] basis-[34rem] flex-col gap-4">
          <Card className="p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
              Answer as delivered
            </div>
            <p className="mt-2.5 whitespace-pre-wrap text-[15px] leading-7 text-slate-800">
              {data.answer}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
              <Badge tone="slate">
                <span className="font-mono">{fmtNum(data.outputTokens)} output tokens</span>
              </Badge>
              <Badge tone="slate">
                <span className="font-mono">{data.keptCount} passages used</span>
              </Badge>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="flex items-center gap-1 font-medium text-slate-900">
                What retrieval returned
                <InfoTip title="Match score">
                  Cosine similarity between the question and the passage, shown as 0–100%. Anything
                  under {fmtPct(data.similarityFloor)} is discarded rather than sent to the model.
                </InfoTip>
              </h2>
              <span className="text-xs text-slate-500">
                {data.retrievedCount} nearest chunks · floor {fmtPct(data.similarityFloor)} ·{' '}
                {data.keptCount} passed
              </span>
            </div>

            {data.chunks.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">
                No chunks were recorded for this query.
              </p>
            ) : (
              <>
                <ScoreScale chunks={data.chunks} floor={data.similarityFloor} />
                <div className="mt-4 space-y-2.5">
                  {data.chunks.map((c) => (
                    <ChunkRow key={c.chunkId} chunk={c} />
                  ))}
                </div>
              </>
            )}

            {discarded > 0 && (
              <p className="mt-4 text-xs leading-relaxed text-slate-500">
                {discarded} passage{discarded === 1 ? '' : 's'} scored below the floor and never
                reached the model. If one of them was the right answer, the corpus — or the floor —
                is what needs changing, not the prompt.
              </p>
            )}
          </Card>
        </div>

        <aside className="flex min-w-0 flex-1 basis-72 flex-col gap-4">
          <Card className="p-5">
            <h2 className="font-medium text-slate-900">Where the {fmtMs(data.totalMs)} went</h2>
            <div className="mt-3.5 space-y-3">
              <Split label="HNSW retrieve" ms={data.retrievalMs} total={data.totalMs} />
              <Split
                label="Time to first token"
                ms={Math.max(0, data.ttftMs - data.retrievalMs)}
                total={data.totalMs}
              />
              <Split
                label="Streaming the answer"
                ms={Math.max(0, data.totalMs - data.ttftMs)}
                total={data.totalMs}
              />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-medium text-slate-900">Cost and model</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <Fact label="Input tokens" value={fmtNum(data.inputTokens)} />
              <Fact label="Output tokens" value={fmtNum(data.outputTokens)} />
              <Fact label="Estimated cost" value={fmtCost(data.estCostUsd)} />
              <Fact label="Embedding cost" value="$0" />
            </dl>
            <div className="mt-3.5 space-y-1.5 border-t border-slate-200 pt-3.5">
              <KeyValue label="Generation" value={data.model || '— (refused)'} />
              <KeyValue label="Vector index" value="pgvector HNSW" />
              <KeyValue label="Namespace" value={data.corpus === 'user' ? 'this link' : 'default corpus'} />
            </div>
          </Card>

          {data.feedback === 'dislike' && (
            <Card className="border-red-200 bg-red-50 p-5">
              <h2 className="font-medium text-red-800">Client said it was wrong</h2>
              <p className="mt-1.5 text-sm text-red-700">
                {data.feedbackReason ? `“${data.feedbackReason}”` : 'No reason was given.'}
              </p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  )
}

/** Where each hit sits relative to the floor, in one strip. */
function ScoreScale({ chunks, floor }: { chunks: RetrievedChunk[]; floor: number }) {
  const best = Math.max(floor, ...chunks.map((c) => c.score ?? 0))
  return (
    <div className="relative mt-4 h-9 overflow-hidden rounded-md bg-slate-100">
      <div
        className="absolute inset-y-0 left-0 bg-indigo-100"
        style={{ width: `${Math.min(100, best * 100)}%` }}
      />
      <div
        className="absolute inset-y-0 w-0.5 bg-amber-600"
        style={{ left: `${Math.min(100, floor * 100)}%` }}
      />
      <span
        className="absolute top-1 pl-2 text-[11px] font-medium text-amber-700"
        style={{ left: `${Math.min(100, floor * 100)}%` }}
      >
        floor {fmtPct(floor)}
      </span>
      <span className="absolute left-2 top-1 text-[11px] font-medium text-indigo-700">
        best {fmtPct(best)}
      </span>
    </div>
  )
}

function ChunkRow({ chunk }: { chunk: RetrievedChunk }) {
  const score = chunk.score ?? 0
  return (
    <div
      className={`flex gap-3.5 rounded-lg border px-4 py-3.5 ${
        chunk.used ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50'
      }`}
    >
      <span
        className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] font-mono text-[11px] font-semibold ${
          chunk.used
            ? 'border border-indigo-200 bg-indigo-50 text-indigo-700'
            : 'bg-slate-200 text-slate-500'
        }`}
      >
        {chunk.rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={`text-sm font-medium ${chunk.used ? 'text-slate-800' : 'text-slate-500'}`}>
            {chunk.filename}
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            {chunk.page ? `page ${chunk.page} · ` : ''}chunk {chunk.ordinal + 1} of{' '}
            {chunk.docChunks} · {fmtNum(chunk.tokenCount)} tok
          </span>
        </div>
        <p
          className={`mt-1 line-clamp-3 text-sm leading-relaxed ${
            chunk.used ? 'text-slate-600' : 'text-slate-400'
          }`}
        >
          “{chunk.snippet}”
        </p>
        <div className="mt-2">
          {chunk.used ? (
            <Badge tone="green">sent to the model</Badge>
          ) : (
            <Badge tone="amber">below the floor — discarded</Badge>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <span
          className={`font-mono text-base font-medium ${
            chunk.used ? 'text-slate-900' : 'text-slate-400'
          }`}
        >
          {fmtPct(score)}
        </span>
        <div className="text-[10px] uppercase tracking-wider text-slate-400">match</div>
      </div>
    </div>
  )
}

function Split({ label, ms, total }: { label: string; ms: number; total: number }) {
  return (
    <div>
      <div className="flex justify-between">
        <span className="text-xs text-slate-600">{label}</span>
        <span className="font-mono text-xs text-slate-800">{fmtMs(ms)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-indigo-500"
          style={{ width: `${total ? (ms / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-mono text-base text-slate-800">{value}</dd>
    </div>
  )
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="truncate font-mono text-xs text-slate-800">{value}</span>
    </div>
  )
}
