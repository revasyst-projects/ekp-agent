import { useEffect, useRef, useState } from 'react'
import { query, sendFeedback } from '../../api/client'
import type { Citation, Corpus, QueryStats } from '../../api/types'
import { Badge, InfoTip, MatchScore, Spinner } from '../../components/ui'
import { fmtCost, fmtMs, fmtNum } from '../../utils/format'
import SourcePanel from './SourcePanel'

const STARTERS = [
  'How many PTO days do employees get?',
  'How is customer data encrypted?',
  'How does Nova Search keep answers grounded?',
]

interface Exchange {
  id: string
  question: string
  citations: Citation[]
  answer: string
  grounded: boolean | null
  followups: string[]
  stats: QueryStats | null
  queryId: string | null
  done: boolean
  error: string | null
}

interface Props {
  token: string
  corpus: Corpus
  hasDocs: boolean
  remaining: number
  seedQuestion?: string
  onQueryDone: () => void
}

export default function QueryPanel({
  token,
  corpus,
  hasDocs,
  remaining,
  seedQuestion = '',
  onQueryDone,
}: Props) {
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  /** the citation whose passage is open in the side panel */
  const [preview, setPreview] = useState<Citation | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const seeded = useRef(false)

  const outOfBudget = remaining <= 0
  const disabled = busy || !hasDocs || outOfBudget

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [exchanges.length])

  // a question typed on the landing page is asked as soon as we arrive
  useEffect(() => {
    if (seeded.current || !seedQuestion || disabled) return
    seeded.current = true
    void ask(seedQuestion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedQuestion, disabled])

  function patch(id: string, fn: (e: Exchange) => Exchange) {
    setExchanges((prev) => prev.map((e) => (e.id === id ? fn(e) : e)))
  }

  async function ask(question: string) {
    const q = question.trim()
    if (!q || disabled) return
    setInput('')
    setBusy(true)
    const id = Math.random().toString(36).slice(2)
    setExchanges((prev) => [
      ...prev,
      {
        id,
        question: q,
        citations: [],
        answer: '',
        grounded: null,
        followups: [],
        stats: null,
        queryId: null,
        done: false,
        error: null,
      },
    ])

    await query(token, corpus, q, [], (e) => {
      switch (e.type) {
        case 'sources':
          patch(id, (x) => ({ ...x, citations: e.citations }))
          break
        case 'grounded':
          patch(id, (x) => ({ ...x, grounded: e.grounded }))
          break
        case 'token':
          patch(id, (x) => ({ ...x, answer: x.answer + e.text }))
          break
        case 'followups':
          patch(id, (x) => ({ ...x, followups: e.questions }))
          break
        case 'done':
          patch(id, (x) => ({ ...x, stats: e.stats, queryId: e.queryId, done: true }))
          break
        case 'error':
          patch(id, (x) => ({ ...x, error: e.message, done: true }))
          break
      }
    })

    setBusy(false)
    onQueryDone()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-wrap items-stretch">
      <section className="flex min-w-0 flex-[500] basis-[26rem] flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3.5 border-b border-slate-200 bg-white px-9 py-5">
          <div>
            <h1 className="font-medium text-slate-900">Ask the knowledge base</h1>
            <p className="mt-1 text-xs text-slate-500">
              Answers are built only from the indexed passages, and every claim is linked to one.
            </p>
          </div>
          <Badge tone={outOfBudget ? 'red' : 'slate'}>
            {remaining} question{remaining === 1 ? '' : 's'} left
          </Badge>
        </header>

        <div className="flex flex-1 flex-col gap-7 px-9 pb-3 pt-8">
          {exchanges.length === 0 && (
            <EmptyState
              corpus={corpus}
              hasDocs={hasDocs}
              disabled={disabled}
              onAsk={ask}
            />
          )}

          {exchanges.map((x) => (
            <ExchangeView
              key={x.id}
              x={x}
              token={token}
              onFollowup={ask}
              followupsDisabled={disabled}
              onPreview={setPreview}
              activeCitation={preview}
            />
          ))}
          <div ref={endRef} />
        </div>

        <footer className="border-t border-slate-200 bg-white px-9 pb-6 pt-4">
          <form
            className="flex max-w-[54rem] items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              ask(input)
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={disabled}
              placeholder={
                outOfBudget
                  ? 'The question limit for this link is used up'
                  : !hasDocs
                    ? 'Upload a document first…'
                    : 'Ask about these documents…'
              }
              className="min-w-0 flex-1 rounded-full border border-slate-300 bg-white px-5 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-100 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={disabled || !input.trim()}
              className="shrink-0 rounded-full bg-indigo-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? 'Answering…' : 'Ask'}
            </button>
          </form>
          <p className="mt-2 text-[11px] text-slate-400">
            {remaining} question{remaining === 1 ? '' : 's'} left on this link · Enter to send
          </p>
        </footer>
      </section>

      {/* the source opens beside the answer, not in a second browser tab */}
      {preview && (
        <SourcePanel citation={preview} token={token} onClose={() => setPreview(null)} />
      )}
    </div>
  )
}

function EmptyState({
  corpus,
  hasDocs,
  disabled,
  onAsk,
}: {
  corpus: Corpus
  hasDocs: boolean
  disabled: boolean
  onAsk: (q: string) => void
}) {
  if (!hasDocs) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Ingest at least one document, then ask your first question here.
      </p>
    )
  }
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
        Try asking
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(corpus === 'default' ? STARTERS : ['What does this document cover?']).map((s) => (
          <button
            key={s}
            onClick={() => onAsk(s)}
            disabled={disabled}
            className="rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-medium text-indigo-700 transition hover:border-indigo-400 hover:bg-indigo-100 disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- exchange

function ExchangeView({
  x,
  token,
  onFollowup,
  followupsDisabled,
  onPreview,
  activeCitation,
}: {
  x: Exchange
  token: string
  onFollowup: (q: string) => void
  followupsDisabled: boolean
  onPreview: (c: Citation) => void
  activeCitation: Citation | null
}) {
  return (
    <div className="fade-up">
      <div className="flex justify-end">
        <p className="max-w-[72%] rounded-[20px] rounded-br-md bg-indigo-600 px-5 py-3.5 text-[15px] text-white shadow-sm">
          {x.question}
        </p>
      </div>

      <article className="mt-7 flex max-w-[54rem] flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          {x.grounded === null && !x.done ? (
            <Badge tone="slate">
              <Spinner className="size-3" /> Searching the documents…
            </Badge>
          ) : x.grounded ? (
            <>
              <Badge tone="green">✓ Grounded</Badge>
              <span className="text-xs text-slate-500">
                {x.citations.length} passage{x.citations.length === 1 ? '' : 's'} matched closely
                enough to be used
              </span>
            </>
          ) : (
            <Badge tone="amber">No close enough match</Badge>
          )}
        </div>

        {x.error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
            <span className="font-semibold">Something went wrong.</span> {x.error}
          </p>
        )}

        {x.grounded === false && x.done && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
            Nothing in the indexed documents answers this closely enough, so the platform declined
            rather than guessing.
          </p>
        )}

        {(x.answer || !x.done) && (
          <p className="text-[15px] leading-[30px] text-slate-800">
            <AnswerText
              text={x.answer}
              citations={x.citations}
              streaming={!x.done}
              onPreview={onPreview}
            />
          </p>
        )}

        {x.citations.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3.5">
              <span className="text-sm font-medium text-slate-800">
                {x.citations.length} source{x.citations.length === 1 ? '' : 's'}
              </span>
              <span className="text-xs text-slate-400">click a passage to read it in place</span>
            </div>
            {x.citations.map((c, i) => (
              <CitationRow
                key={c.id}
                c={c}
                active={activeCitation?.id === c.id && activeCitation?.docId === c.docId}
                last={i === x.citations.length - 1}
                onPreview={onPreview}
              />
            ))}
          </section>
        )}

        {x.done && x.stats && <EngineeringDetail stats={x.stats} />}

        {x.followups.length > 0 && (
          <div>
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              Ask next
            </div>
            <div className="flex flex-wrap gap-2.5">
              {x.followups.map((f) => (
                <button
                  key={f}
                  onClick={() => onFollowup(f)}
                  disabled={followupsDisabled}
                  className="rounded-full border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-600 transition hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-50"
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}

        {x.done && x.queryId && (
          <div className="border-t border-slate-200 pt-3.5">
            <FeedbackRow queryId={x.queryId} token={token} />
          </div>
        )}
      </article>
    </div>
  )
}

/** Renders streamed answer text, turning [n] markers into citation chips. */
function AnswerText({
  text,
  citations,
  streaming,
  onPreview,
}: {
  text: string
  citations: Citation[]
  streaming: boolean
  onPreview: (c: Citation) => void
}) {
  const parts = text.split(/(\[\d+\])/g)
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/)
        const c = m ? citations.find((c) => c.id === Number(m[1])) : undefined
        return c ? (
          <button
            key={i}
            onClick={() => onPreview(c)}
            title={`${c.filename} — open this passage`}
            className="mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-[5px] border border-indigo-200 bg-indigo-50 px-1 align-middle font-mono text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-600 hover:text-white"
          >
            {c.id}
          </button>
        ) : (
          <span key={i}>{part}</span>
        )
      })}
      {streaming && (
        <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-indigo-500 align-text-bottom" />
      )}
    </>
  )
}

function CitationRow({
  c,
  active,
  last,
  onPreview,
}: {
  c: Citation
  active: boolean
  last: boolean
  onPreview: (c: Citation) => void
}) {
  return (
    <div
      className={`flex gap-3.5 px-5 py-4 ${last ? '' : 'border-b border-slate-100'} ${
        active ? 'bg-indigo-50' : ''
      }`}
    >
      <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-indigo-200 bg-indigo-50 font-mono text-[11px] font-semibold text-indigo-700">
        {c.id}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => onPreview(c)}
            className="text-sm font-medium text-slate-800 hover:text-indigo-700"
          >
            {c.filename}
          </button>
          {/* location detail would clutter the row, so it lives in the tip */}
          <InfoTip title="Where this came from">
            {c.page ? `Page ${c.page} · ` : ''}characters {fmtNum(c.charStart)}–{fmtNum(c.charEnd)}.
            Opening it jumps to this exact spot.
          </InfoTip>
        </div>
        <button
          onClick={() => onPreview(c)}
          className="mt-1.5 block text-left text-sm leading-relaxed text-slate-500 hover:text-slate-700"
        >
          “{c.snippet}”
        </button>
      </div>
      <div className="shrink-0">
        <MatchScore score={c.score} />
      </div>
    </div>
  )
}

/** Timings, tokens and cost — one line, folded away until asked for. */
function EngineeringDetail({ stats }: { stats: QueryStats }) {
  const [open, setOpen] = useState(false)
  const total = Math.max(1, stats.totalMs)
  const segments = [
    { label: 'retrieve', ms: stats.retrievalMs, color: 'bg-indigo-700' },
    { label: 'first token', ms: Math.max(0, stats.ttftMs - stats.retrievalMs), color: 'bg-indigo-500' },
    { label: 'stream', ms: Math.max(0, stats.totalMs - stats.ttftMs), color: 'bg-indigo-200' },
  ]

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2.5 px-5 py-3.5 text-left"
      >
        <span className="text-slate-400">{open ? '▴' : '▾'}</span>
        <span className="flex-1 text-sm font-medium text-slate-800">
          Answered in {fmtMs(stats.totalMs)}
        </span>
        <span className="font-mono text-xs text-slate-500">
          {fmtNum(stats.inputTokens)} in / {fmtNum(stats.outputTokens)} out ·{' '}
          {fmtCost(stats.estCostUsd)}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-200 px-5 pb-5 pt-4">
          <div className="flex flex-wrap gap-2">
            {segments.map((s) => (
              <Badge key={s.label} tone="slate">
                <span className="font-mono">
                  {s.label} {fmtMs(s.ms)}
                </span>
              </Badge>
            ))}
          </div>
          <div className="mt-3.5 flex h-2 overflow-hidden rounded-full bg-slate-200">
            {segments.map((s) => (
              <span
                key={s.label}
                className={s.color}
                style={{ width: `${(s.ms / total) * 100}%` }}
              />
            ))}
          </div>
          <dl className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Model" value={stats.model} />
            <Fact label="Retrieval" value={fmtMs(stats.retrievalMs)} />
            <Fact label="First token" value={fmtMs(stats.ttftMs)} />
            <Fact label="Est. cost" value={fmtCost(stats.estCostUsd)} />
          </dl>
        </div>
      )}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-mono text-sm text-slate-800">{value}</dd>
    </div>
  )
}

function FeedbackRow({ queryId, token }: { queryId: string; token: string }) {
  const [verdict, setVerdict] = useState<'like' | 'dislike' | null>(null)
  const [reason, setReason] = useState('')
  const [sent, setSent] = useState(false)

  async function send(v: 'like' | 'dislike', withReason?: string) {
    setVerdict(v)
    await sendFeedback(token, queryId, v, withReason || undefined)
    setSent(true)
  }

  if (sent) {
    return (
      <p className="text-xs text-slate-500">
        Feedback recorded {verdict === 'like' ? '👍' : '👎'} — thank you.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs text-slate-500">Did this answer hold up?</span>
      <button
        onClick={() => send('like')}
        aria-label="This answer was useful"
        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:border-emerald-400 hover:text-emerald-600"
      >
        👍
      </button>
      <button
        onClick={() => setVerdict('dislike')}
        aria-label="This answer was wrong or unhelpful"
        className={`rounded-full border bg-white px-3 py-1.5 text-xs transition ${
          verdict === 'dislike'
            ? 'border-red-300 text-red-600'
            : 'border-slate-300 text-slate-600 hover:border-red-400 hover:text-red-600'
        }`}
      >
        👎
      </button>
      {verdict === 'dislike' && (
        <span className="flex flex-1 gap-2">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send('dislike', reason)}
            placeholder="What was wrong? (optional)"
            className="min-w-40 flex-1 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
          />
          <button
            onClick={() => send('dislike', reason)}
            className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-200"
          >
            Send
          </button>
        </span>
      )}
    </div>
  )
}
