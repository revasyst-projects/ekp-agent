import { useState } from 'react'
import { requestExtension } from '../../api/client'
import { Card } from '../../components/ui'
import { fmtDateTime } from '../../utils/format'

export type BlockReason = 'invalid' | 'revoked' | 'expired'

const COPY: Record<BlockReason, { title: string; body: string }> = {
  invalid: {
    title: 'This link does not open anything',
    // deliberately vague: never confirm whether a token ever existed
    body: 'Check that you copied the whole URL, or ask the person who shared it for a fresh one.',
  },
  revoked: {
    title: 'This link was switched off',
    body: 'The sender closed access to this workspace. They can reopen it, or send you a new link.',
  },
  expired: {
    title: 'Your access window closed',
    body: 'Links are time-limited so a shared URL cannot be passed around indefinitely.',
  },
}

const SPANS = [
  { hours: 24, label: '1 more day' },
  { hours: 72, label: '3 more days' },
  { hours: 168, label: '1 more week' },
  { hours: 720, label: '1 more month' },
]

interface Props {
  reason: BlockReason
  token?: string
  expiresAt?: string
  /** true when a request is already waiting on the admin's desk */
  alreadyRequested?: boolean
}

/**
 * The one screen a prospect sees when the workspace will not open. Expiry is
 * the only recoverable case, so it is the only one that offers a way out:
 * the request lands in the admin portal, where one click reopens the same
 * link with the conversation intact.
 */
export default function Blocked({ reason, token, expiresAt, alreadyRequested = false }: Props) {
  const { title, body } = COPY[reason]
  const canAsk = reason === 'expired' && !!token

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-8 py-4">
        <Mark />
        <div className="text-sm font-semibold text-slate-900">Enterprise Knowledge Platform</div>
      </header>

      <main className="flex flex-1 justify-center px-6 py-12">
        <div className="w-full max-w-2xl space-y-6">
          <Card className="p-7">
            <div className="flex items-start gap-4">
              <div
                className={`flex size-11 shrink-0 items-center justify-center rounded-full ${
                  reason === 'expired'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-6">
                  {reason === 'expired' ? (
                    <path d="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <path d="M12 9v4m0 4h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                </svg>
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
                <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
                  {reason === 'expired' && expiresAt ? (
                    <>
                      This workspace was open until{' '}
                      <strong className="text-slate-800">{fmtDateTime(expiresAt)}</strong>. {body}
                    </>
                  ) : (
                    body
                  )}
                </p>
              </div>
            </div>

            {canAsk && (
              <ExtensionForm token={token!} alreadySent={alreadyRequested} />
            )}
          </Card>

          {reason === 'expired' && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-slate-900">What happens to your files</h2>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
                <li>
                  Documents you uploaded are held for 7 days after expiry, then deleted. An
                  extension granted before then restores them.
                </li>
                <li>
                  Your questions and their answers stay with the link, so the conversation picks up
                  where it stopped.
                </li>
              </ul>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}

function ExtensionForm({ token, alreadySent }: { token: string; alreadySent: boolean }) {
  const [hours, setHours] = useState(168)
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(alreadySent)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (sent) {
    return (
      <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-medium text-emerald-800">Your request is with the sender.</p>
        <p className="mt-1 text-sm text-emerald-700">
          When they approve it this same URL starts working again — no new link to wait for.
        </p>
      </div>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await requestExtension(token, hours, note.trim() || undefined)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the request.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-5">
      <h2 className="text-base font-semibold text-slate-900">Need more time?</h2>
      <p className="mt-1 text-sm leading-relaxed text-indigo-900/80">
        Send the request straight to the sender. One click on their side reopens this link with
        your conversation intact.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-44">
          <span className="text-xs font-medium text-indigo-900/70">How much longer</span>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none"
          >
            {SPANS.map((s) => (
              <option key={s.hours} value={s.hours}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-52 flex-1">
          <span className="text-xs font-medium text-indigo-900/70">Anything to add (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. still waiting on legal to review"
            className="mt-1 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Request extension'}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  )
}

function Mark() {
  return (
    <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4.5">
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" strokeLinejoin="round" />
        <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" strokeLinejoin="round" />
      </svg>
    </div>
  )
}
