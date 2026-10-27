import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getLinkInfo, warm } from '../../api/client'
import type { LinkInfo } from '../../api/types'
import { Badge, Logo, Spinner } from '../../components/ui'
import { expiryText } from '../../utils/format'
import Blocked from './Blocked'

/**
 * What a prospect sees when the link opens: a headline, the ask box, and two
 * ways in. No paragraph of marketing copy — the promises are three icons, and
 * the first thing on the page is the thing you do.
 */
export default function Landing() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [warmed, setWarmed] = useState(false)
  const [question, setQuestion] = useState('')

  useEffect(() => {
    let cancelled = false
    getLinkInfo(token)
      .then((i) => {
        if (cancelled) return
        setInfo(i)
        // predictive warm-up: heat embedder/DB/LLM while the prospect reads
        warm(token)
          .then(() => !cancelled && setWarmed(true))
          .catch(() => {})
      })
      .catch(() => !cancelled && setInvalid(true))
    return () => {
      cancelled = true
    }
  }, [token])

  if (invalid) return <Blocked reason="invalid" />

  if (!info) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-slate-500">
        <Spinner /> Loading workspace…
      </div>
    )
  }

  const expiry = expiryText(info.expiresAt)
  if (info.revoked) return <Blocked reason="revoked" token={token} />
  if (expiry.expired)
    return (
      <Blocked
        reason="expired"
        token={token}
        expiresAt={info.expiresAt}
        alreadyRequested={info.extensionRequested}
      />
    )

  function ask(q: string) {
    const trimmed = q.trim()
    navigate(
      `/p/${token}/w?mode=default${trimmed ? `&q=${encodeURIComponent(trimmed)}` : ''}`,
    )
  }

  const daysLeft = Math.max(
    1,
    Math.round((Date.parse(info.expiresAt) - Date.now()) / 86_400_000),
  )

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 bg-[radial-gradient(circle,rgba(79,70,229,0.14)_1px,transparent_1px)] [background-position:center_top] [background-size:26px_26px]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-gradient-to-b from-transparent via-transparent to-slate-50" />

      <header className="relative flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-8 py-3.5">
        <div className="flex items-center gap-2.5">
          <Logo className="size-8" />
          <span className="text-sm font-semibold text-slate-900">{info.label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={warmed ? 'green' : 'slate'}>
            {warmed ? <Dot className="bg-emerald-500" /> : <Spinner className="size-3" />}
            {warmed ? 'Ready' : 'Warming'}
          </Badge>
          <Badge tone="slate">Private</Badge>
          <Badge tone="slate">{daysLeft} days</Badge>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col items-center px-8 pb-10 pt-16">
        <div className="flex w-full max-w-3xl flex-col items-center gap-8">
          <h1 className="text-center text-4xl font-semibold tracking-tight text-slate-900">
            Ask your documents anything.
          </h1>

          {/* the ask bar is the hero */}
          <div className="w-full max-w-2xl">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                ask(question)
              }}
              className="flex items-center gap-2.5 rounded-full border border-slate-200 bg-white py-2 pl-5 pr-2 shadow-[0_10px_30px_-14px_rgba(15,23,42,0.28)] focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-100"
            >
              <SearchIcon />
              <label htmlFor="ask" className="sr-only">
                Ask a question about these documents
              </label>
              <input
                id="ask"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question…"
                className="min-w-0 flex-1 bg-transparent py-2 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="submit"
                className="shrink-0 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
              >
                Ask →
              </button>
            </form>

            <div className="mt-3.5 flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:border-indigo-400 hover:bg-indigo-100"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* three promises, no sentences */}
          <div className="grid w-full gap-4 sm:grid-cols-3">
            <Promise title="Every claim cited" caption="click → exact passage" icon={ICON_QUOTE} />
            <Promise title="Never guesses" caption="declines instead" icon={ICON_BLOCK} />
            <Promise title="Stays on this box" caption="local embeddings" icon={ICON_SERVER} />
          </div>

          {/* two doors */}
          <div className="flex w-full flex-wrap gap-4">
            <Door
              title="Sample corpus"
              stats="3 docs · pre-indexed · ready"
              icon={ICON_LIBRARY}
              highlight
              onClick={() => navigate(`/p/${token}/w?mode=default`)}
            />
            <Door
              title="Your own files"
              stats={`${info.maxIngestions} files · 25 MB · pdf txt md docx`}
              icon={ICON_UPLOAD}
              onClick={() => navigate(`/p/${token}/w?mode=user`)}
            />
          </div>
        </div>
      </main>

      <footer className="relative flex flex-wrap justify-center gap-3 border-t border-slate-200 bg-white px-8 py-3 font-mono text-[11px] text-slate-400">
        <span>{info.maxQueries} questions</span>
        <span>·</span>
        <span>{info.maxIngestions} uploads</span>
        <span>·</span>
        <span>closes {new Date(info.expiresAt).toLocaleString()}</span>
      </footer>
    </div>
  )
}

const STARTERS = [
  'PTO days?',
  'Data encryption?',
  'How are answers kept grounded?',
]

function Promise({
  title,
  caption,
  icon,
}: {
  title: string
  caption: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span className="flex size-11 items-center justify-center rounded-full border border-slate-200 bg-white text-indigo-600">
        {icon}
      </span>
      <span>
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <span className="text-xs text-slate-500">{caption}</span>
      </span>
    </div>
  )
}

function Door({
  title,
  stats,
  icon,
  onClick,
  highlight = false,
}: {
  title: string
  stats: string
  icon: React.ReactNode
  onClick: () => void
  highlight?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex min-w-0 flex-1 basis-72 items-center gap-3.5 rounded-[28px] border bg-white px-5 py-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
        highlight ? 'border-indigo-500 ring-[3px] ring-indigo-100' : 'border-slate-200'
      }`}
    >
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-full ${
          highlight ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-slate-900">{title}</span>
        <span className="font-mono text-xs text-slate-500">{stats}</span>
      </span>
      <span className={highlight ? 'text-indigo-600' : 'text-slate-400'}>→</span>
    </button>
  )
}

function Dot({ className }: { className: string }) {
  return <span className={`size-1.5 rounded-full ${className}`} />
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5 shrink-0 text-slate-400">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  className: 'size-5',
} as const

const ICON_QUOTE = (
  <svg {...iconProps}>
    <path d="M7 7h4v6a4 4 0 0 1-4 4V7zm8 0h4v6a4 4 0 0 1-4 4V7z" strokeLinejoin="round" />
  </svg>
)
const ICON_BLOCK = (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" strokeLinecap="round" />
  </svg>
)
const ICON_SERVER = (
  <svg {...iconProps}>
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="13" width="18" height="7" rx="2" />
    <path d="M7 7.5h.01M7 16.5h.01" strokeLinecap="round" />
  </svg>
)
const ICON_LIBRARY = (
  <svg {...iconProps}>
    <path d="M5 4h5v16H5zM14 4h5v16h-5z" strokeLinejoin="round" />
  </svg>
)
const ICON_UPLOAD = (
  <svg {...iconProps}>
    <path d="M12 16V5m0 0L8 9m4-4l4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
