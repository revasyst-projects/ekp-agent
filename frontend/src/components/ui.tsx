import type { ReactNode } from 'react'
import { useState } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  )
}

type BadgeTone = 'slate' | 'green' | 'amber' | 'red' | 'indigo' | 'sky'

const badgeTones: Record<BadgeTone, string> = {
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  sky: 'bg-sky-50 text-sky-700 border-sky-200',
}

export function Badge({
  tone = 'slate',
  className = '',
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeTones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin text-indigo-600 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  )
}

export function CheckIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.8a1 1 0 0 1 1.4 0z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-100"
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  )
}

/**
 * A detail that would clutter the line it belongs to: an ⓘ button whose
 * tooltip carries it. Hover and keyboard focus both open it — the detail is
 * never the only place a fact lives, so a touch device loses nothing.
 */
export function InfoTip({ title, children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={title ?? 'More detail'}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="flex size-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM9 8a1 1 0 0 1 2 0v5a1 1 0 1 1-2 0V8zm1-3.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-20 mb-1.5 w-60 -translate-x-1/2 rounded-lg bg-slate-800 px-3 py-2 text-left text-[11px] leading-relaxed text-slate-100 shadow-lg"
        >
          {title && <span className="mb-0.5 block font-semibold text-white">{title}</span>}
          {children}
        </span>
      )}
    </span>
  )
}

/**
 * A retrieval score as a percentage with its own explanation attached —
 * a bare "0.84" means nothing to someone seeing the product for the first
 * time.
 */
export function MatchScore({
  score,
  floor,
  muted = false,
}: {
  score: number
  floor?: number
  muted?: boolean
}) {
  const pct = Math.round(score * 100)
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={muted ? 'slate' : 'indigo'}>
        <span className="font-mono">{pct}% match</span>
      </Badge>
      <InfoTip title="Match score">
        How closely this passage matches your question, from 0 to 100%.
        {floor !== undefined && (
          <> Anything under {Math.round(floor * 100)}% is discarded rather than shown to the model.</>
        )}
      </InfoTip>
    </span>
  )
}

/** A labelled progress bar used for budgets and usage. */
export function Meter({ pct, tone = 'indigo' }: { pct: number; tone?: 'indigo' | 'amber' | 'red' }) {
  const bar = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-indigo-500'
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}

/** A compact headline figure for the analytics and link-detail pages. */
export function Kpi({
  label,
  value,
  sub,
  tone = 'slate',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'slate' | 'green' | 'amber'
}) {
  const valueTone =
    tone === 'green' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900'
  return (
    <Card className="px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 font-mono text-2xl font-semibold ${valueTone}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </Card>
  )
}

export function Logo({ className = 'size-9' }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-sky-600 font-bold text-white ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-5" stroke="currentColor" strokeWidth="2">
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" strokeLinejoin="round" />
        <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
