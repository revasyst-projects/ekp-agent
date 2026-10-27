import { useMemo, useState } from 'react'
import { adminExtendLink } from '../../api/client'
import { MAX_WINDOW_HOURS, type ProposalLink } from '../../api/types'
import { Spinner } from '../../components/ui'
import { expiryText, fmtDateTime } from '../../utils/format'

const PRESETS = [
  { hours: 24, label: '+1 day' },
  { hours: 72, label: '+3 days' },
  { hours: 168, label: '+1 week' },
  { hours: 720, label: '+1 month' },
  { hours: 2160, label: '+3 months' },
]

type Anchor = 'now' | 'current'

interface Props {
  link: ProposalLink
  onClose: () => void
  onExtended: (link: ProposalLink) => void
}

/**
 * Push a link's window out. Extending reuses the same token, so a URL already
 * in a client's inbox keeps working — which is why this is a dialog on the
 * row rather than "revoke and mint a new one".
 */
export default function ExtendDialog({ link, onClose, onExtended }: Props) {
  const expiry = expiryText(link.expiresAt)
  const [hours, setHours] = useState<number | null>(link.pendingExtension?.hours ?? 168)
  const [custom, setCustom] = useState('')
  const [anchor, setAnchor] = useState<Anchor>(expiry.expired ? 'now' : 'current')
  const [topUp, setTopUp] = useState(link.usedQueries >= link.maxQueries)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preview = useMemo(() => {
    if (custom) {
      const t = Date.parse(custom)
      return Number.isNaN(t) ? null : new Date(t)
    }
    if (hours === null) return null
    const base =
      anchor === 'current' ? Math.max(Date.now(), Date.parse(link.expiresAt)) : Date.now()
    return new Date(base + hours * 3_600_000)
  }, [custom, hours, anchor, link.expiresAt])

  const ceiling = Date.now() + MAX_WINDOW_HOURS * 3_600_000
  const tooFar = preview !== null && preview.getTime() > ceiling
  const inPast = preview !== null && preview.getTime() <= Date.now()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!preview || tooFar || inPast) return
    setBusy(true)
    setError(null)
    try {
      const updated = await adminExtendLink(link.id, {
        ...(custom ? { expiresAt: preview.toISOString() } : { hours: hours!, anchor }),
        topUpQueries: topUp ? link.maxQueries + 25 : undefined,
        requestId: link.pendingExtension?.id,
      })
      onExtended(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not extend the link.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-slate-900/45 px-4 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={`Extend access for ${link.label}`}
      >
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-700">
            <ClockIcon />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-slate-900">Extend access</h2>
            <p className="mt-0.5 truncate text-sm text-slate-500">{link.label}</p>
          </div>
        </div>

        <p
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            expiry.expired
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-slate-200 bg-slate-50 text-slate-600'
          }`}
        >
          Currently {expiry.text} — {fmtDateTime(link.expiresAt)}.
          {link.pendingExtension && (
            <>
              {' '}
              The client asked for{' '}
              <strong>{Math.round(link.pendingExtension.hours / 24)} more days</strong>
              {link.pendingExtension.note && <> — “{link.pendingExtension.note}”</>}.
            </>
          )}
        </p>

        <fieldset className="mt-5">
          <legend className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
            How much longer
          </legend>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.hours}
                type="button"
                onClick={() => {
                  setHours(p.hours)
                  setCustom('')
                }}
                className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                  hours === p.hours && !custom
                    ? 'border-indigo-500 bg-indigo-50 font-medium text-indigo-700'
                    : 'border-slate-300 text-slate-600 hover:border-slate-400'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 flex flex-wrap gap-3">
          <label className="min-w-52 flex-1">
            <span className="text-xs text-slate-500">Or pick an exact moment</span>
            <input
              type="datetime-local"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <label className="min-w-40 flex-1">
            <span className="text-xs text-slate-500">Counted from</span>
            <select
              value={anchor}
              disabled={!!custom}
              onChange={(e) => setAnchor(e.target.value as Anchor)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            >
              <option value="now">Now</option>
              <option value="current">The current expiry</option>
            </select>
          </label>
        </div>

        {preview && !tooFar && !inPast && (
          <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Reopens now and closes <strong>{fmtDateTime(preview.toISOString())}</strong> — on the
            same URL, so nothing needs re-sending.
          </p>
        )}
        {tooFar && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            That runs past the one-year ceiling. Pick a nearer date — the rail exists so a link
            cannot quietly become permanent.
          </p>
        )}
        {inPast && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            That moment has already passed.
          </p>
        )}

        <label className="mt-5 flex items-start gap-2.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={topUp}
            onChange={(e) => setTopUp(e.target.checked)}
            className="mt-0.5 size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
          />
          <span>
            Raise the question cap to {link.maxQueries + 25}
            <span className="block text-xs text-slate-400">
              {link.usedQueries} of {link.maxQueries} used so far
            </span>
          </span>
        </label>

        <p className="mt-5 text-[11px] leading-relaxed text-slate-400">
          There is no 72-hour ceiling any more. The one rail left is a hard stop a year out, and
          every change to a window is recorded against the link.
        </p>

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !preview || tooFar || inPast}
            className="flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy && <Spinner className="size-4 text-white" />}
            {preview ? `Extend to ${preview.toLocaleDateString()}` : 'Extend'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
