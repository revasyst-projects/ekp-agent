import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  adminCreateLink,
  adminDeclineRequest,
  adminListLinks,
  adminReinstateLink,
  adminRevokeLink,
} from '../../api/client'
import type { ProposalLink } from '../../api/types'
import { Badge, Card, CopyButton, Kpi, Meter, Spinner } from '../../components/ui'
import { expiryStatus, fmtDateTime, timeAgo } from '../../utils/format'
import ExtendDialog from './ExtendDialog'

type Filter = 'live' | 'expiring' | 'expired' | 'revoked' | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'live', label: 'Live' },
  { key: 'expiring', label: 'Expiring' },
  { key: 'expired', label: 'Expired' },
  { key: 'revoked', label: 'Revoked' },
  { key: 'all', label: 'All' },
]

export default function LinksPage() {
  const [links, setLinks] = useState<ProposalLink[] | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [extending, setExtending] = useState<ProposalLink | null>(null)
  const [justChanged, setJustChanged] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('live')
  const [search, setSearch] = useState('')

  function refresh() {
    adminListLinks().then(setLinks)
  }
  useEffect(refresh, [])

  async function revoke(link: ProposalLink) {
    if (!window.confirm(`Revoke "${link.label}"? The client loses access immediately.`)) return
    await adminRevokeLink(link.id)
    refresh()
  }

  async function reinstate(link: ProposalLink) {
    await adminReinstateLink(link.id)
    setJustChanged(link.id)
    refresh()
  }

  async function decline(link: ProposalLink) {
    if (!link.pendingExtension) return
    await adminDeclineRequest(link.pendingExtension.id)
    refresh()
  }

  const pending = links?.filter((l) => l.pendingExtension) ?? []

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (links ?? []).filter((l) => {
      if (term && !l.label.toLowerCase().includes(term) && !l.url.includes(term)) return false
      const { tone, expired } = expiryStatus(l.expiresAt, l.revoked)
      switch (filter) {
        case 'live':
          return !l.revoked && !expired
        case 'expiring':
          return !l.revoked && !expired && tone === 'amber'
        case 'expired':
          return !l.revoked && expired
        case 'revoked':
          return l.revoked
        default:
          return true
      }
    })
  }, [links, filter, search])

  const totals = useMemo(() => {
    const live = (links ?? []).filter(
      (l) => !l.revoked && !expiryStatus(l.expiresAt, l.revoked).expired,
    )
    return {
      live: live.length,
      total: links?.length ?? 0,
      expiring: live.filter((l) => expiryStatus(l.expiresAt, false).tone === 'amber').length,
      requests: pending.length,
    }
  }, [links, pending.length])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Proposal links</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            One link per bid — unguessable, capped, extendable, revocable.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          + New link
        </button>
      </div>

      {/* a request raised from the expired screen lands at the top */}
      {pending.map((l) => (
        <div
          key={l.id}
          className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <span className="min-w-52 flex-1 text-sm text-amber-900">
            <strong>{l.label}</strong> asked for{' '}
            {Math.round(l.pendingExtension!.hours / 24)} more day
            {Math.round(l.pendingExtension!.hours / 24) === 1 ? '' : 's'}
            {l.pendingExtension!.note && <> — “{l.pendingExtension!.note}”</>}
          </span>
          <button
            onClick={() => setExtending(l)}
            className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            Review and extend
          </button>
          <button
            onClick={() => decline(l)}
            className="rounded-lg px-3 py-1.5 text-sm text-amber-800 transition hover:bg-amber-100"
          >
            Decline
          </button>
        </div>
      ))}

      {showCreate && (
        <CreateLinkForm
          onClose={() => setShowCreate(false)}
          onCreated={(link) => {
            setShowCreate(false)
            setJustChanged(link.id)
            refresh()
          }}
        />
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Live links" value={totals.live} sub={`of ${totals.total} ever minted`} />
        <Kpi
          label="Expiring in 24 h"
          value={totals.expiring}
          tone={totals.expiring > 0 ? 'amber' : 'slate'}
        />
        <Kpi
          label="Extension requests"
          value={totals.requests}
          tone={totals.requests > 0 ? 'amber' : 'slate'}
        />
        <Kpi label="Revoked" value={(links ?? []).filter((l) => l.revoked).length} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by client or label"
          className="min-w-56 flex-1 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
              filter === f.key
                ? 'border-indigo-500 bg-indigo-50 font-medium text-indigo-700'
                : 'border-slate-300 text-slate-600 hover:border-slate-400'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!links ? (
        <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
          <Spinner /> Loading links…
        </div>
      ) : shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-500">
          Nothing matches that filter.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {shown.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              highlight={link.id === justChanged}
              onExtend={() => setExtending(link)}
              onRevoke={() => revoke(link)}
              onReinstate={() => reinstate(link)}
            />
          ))}
        </div>
      )}

      <p className="mt-5 text-[11px] leading-relaxed text-slate-400">
        Caps and the expiry window are re-checked server-side on every request. Extending a link
        never mints a new URL, so one already shared with a client keeps working.
      </p>

      {extending && (
        <ExtendDialog
          link={extending}
          onClose={() => setExtending(null)}
          onExtended={(updated) => {
            setExtending(null)
            setJustChanged(updated.id)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function LinkRow({
  link,
  highlight,
  onExtend,
  onRevoke,
  onReinstate,
}: {
  link: ProposalLink
  highlight: boolean
  onExtend: () => void
  onRevoke: () => void
  onReinstate: () => void
}) {
  const status = expiryStatus(link.expiresAt, link.revoked)
  const fullUrl = `${window.location.origin}${link.url}`
  const queryPct = (link.usedQueries / link.maxQueries) * 100

  return (
    <Card className={`p-4 ${highlight ? 'fade-up border-indigo-300 ring-1 ring-indigo-100' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-56 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <RouterLink
              to={`/admin/links/${link.id}`}
              className="font-medium text-slate-900 hover:text-indigo-700"
            >
              {link.label}
            </RouterLink>
            <Badge tone={status.tone}>{status.text}</Badge>
            {link.pendingExtension && <Badge tone="amber">extension requested</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="truncate font-mono text-xs text-indigo-600 hover:underline"
            >
              {fullUrl}
            </a>
            <CopyButton text={fullUrl} />
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-400">
            closes {fmtDateTime(link.expiresAt)}
          </div>
        </div>

        <div className="min-w-36">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] text-slate-500">Questions</span>
            <span className="font-mono text-[11px] text-slate-600">
              {link.usedQueries} / {link.maxQueries}
            </span>
          </div>
          <Meter pct={queryPct} tone={queryPct >= 100 ? 'red' : queryPct > 80 ? 'amber' : 'indigo'} />
          <div className="mt-2 font-mono text-[11px] text-slate-500">
            {link.usedIngestions} / {link.maxIngestions} uploads · {link.documentCount} indexed
          </div>
        </div>

        <div className="min-w-24 text-right">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">last seen</div>
          <div className="font-mono text-xs text-slate-600">
            {link.lastActivityAt ? timeAgo(link.lastActivityAt) : 'never opened'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onExtend}
            className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
          >
            Extend
          </button>
          {link.revoked ? (
            <button
              onClick={onReinstate}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400"
            >
              Reinstate
            </button>
          ) : (
            <button
              onClick={onRevoke}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:border-red-400 hover:bg-red-50"
            >
              Revoke
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

const WINDOW_PRESETS = [
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
  { hours: 720, label: '1 month' },
]

function CreateLinkForm({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (link: ProposalLink) => void
}) {
  const [label, setLabel] = useState('')
  const [maxIngestions, setMaxIngestions] = useState(5)
  const [maxQueries, setMaxQueries] = useState(25)
  const [hours, setHours] = useState(168)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)

  const expiresInHours = custom
    ? Math.max(1, Math.round((Date.parse(custom) - Date.now()) / 3_600_000))
    : hours

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    setBusy(true)
    const link = await adminCreateLink({
      label: label.trim(),
      maxIngestions,
      maxQueries,
      expiresInHours,
    })
    onCreated(link)
  }

  return (
    <Card className="fade-up mt-5 border-indigo-200 p-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        New proposal link
      </h2>
      <form onSubmit={submit} className="mt-3 space-y-4">
        <label className="block">
          <span className="text-xs text-slate-500">Client / bid</span>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Initech — support KB chatbot"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
        </label>

        <div>
          <span className="text-xs text-slate-500">Open for</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {WINDOW_PRESETS.map((p) => (
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
            <input
              type="datetime-local"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">
            No 72-hour ceiling — and the window can be pushed out later without changing the URL.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField label="Max uploads" value={maxIngestions} onChange={setMaxIngestions} min={1} max={100} />
          <NumberField label="Max questions" value={maxQueries} onChange={setMaxQueries} min={1} max={1000} />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy || !label.trim()}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy && <Spinner className="size-4 text-white" />}
            Generate link
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-slate-800"
          >
            Cancel
          </button>
        </div>
      </form>
    </Card>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
}) {
  return (
    <label>
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      />
    </label>
  )
}
