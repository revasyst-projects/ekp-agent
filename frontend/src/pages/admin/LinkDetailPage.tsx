import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { adminLinkDetail, adminRevokeLink } from '../../api/client'
import type { AccessEvent, LinkDetail } from '../../api/types'
import { Badge, Card, CopyButton, Kpi, Meter, Spinner } from '../../components/ui'
import { expiryStatus, fmtBytes, fmtCost, fmtDateTime, fmtMs, fmtNum, timeAgo } from '../../utils/format'
import ExtendDialog from './ExtendDialog'

type Tab = 'conversation' | 'documents' | 'history'

/** One link, end to end: what it cost, what it was asked, what it ingested. */
export default function LinkDetailPage() {
  const { linkId = '' } = useParams()
  const [data, setData] = useState<LinkDetail | null>(null)
  const [tab, setTab] = useState<Tab>('conversation')
  const [extending, setExtending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    adminLinkDetail(linkId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the link'))
  }, [linkId])

  useEffect(refresh, [refresh])

  if (error) return <p className="py-16 text-center text-sm text-red-600">{error}</p>
  if (!data) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
        <Spinner /> Loading link…
      </div>
    )
  }

  const { link, totals } = data
  const status = expiryStatus(link.expiresAt, link.revoked)
  const fullUrl = `${window.location.origin}${link.url}`

  async function revoke() {
    if (!window.confirm(`Revoke "${link.label}"?`)) return
    await adminRevokeLink(link.id)
    refresh()
  }

  return (
    <div>
      <Link to="/admin/links" className="text-xs text-indigo-600 hover:underline">
        ← All links
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900">{link.label}</h1>
            <Badge tone={status.tone}>{status.text}</Badge>
            {link.pendingExtension && <Badge tone="amber">extension requested</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-xs text-slate-500">{fullUrl}</span>
            <CopyButton text={fullUrl} />
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-400">
            created {fmtDateTime(link.createdAt)} · closes {fmtDateTime(link.expiresAt)}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setExtending(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            Extend
          </button>
          {!link.revoked && (
            <button
              onClick={revoke}
              className="rounded-lg border border-red-200 px-3.5 py-2 text-sm font-medium text-red-600 transition hover:border-red-400 hover:bg-red-50"
            >
              Revoke
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Card className="px-4 py-3">
          <div className="text-xs text-slate-500">Questions</div>
          <div className="mt-0.5 font-mono text-2xl font-semibold text-slate-900">
            {link.usedQueries} / {link.maxQueries}
          </div>
          <div className="mt-2">
            <Meter pct={(link.usedQueries / link.maxQueries) * 100} />
          </div>
        </Card>
        <Card className="px-4 py-3">
          <div className="text-xs text-slate-500">Uploads</div>
          <div className="mt-0.5 font-mono text-2xl font-semibold text-slate-900">
            {link.usedIngestions} / {link.maxIngestions}
          </div>
          <div className="mt-2">
            <Meter pct={(link.usedIngestions / link.maxIngestions) * 100} />
          </div>
        </Card>
        <Kpi
          label="Grounded"
          value={`${totals.grounded} / ${totals.queries}`}
          sub={`${totals.queries - totals.grounded} declined`}
        />
        <Kpi label="Median answer" value={fmtMs(totals.p50Ms)} sub={`p90 ${fmtMs(totals.p90Ms)}`} />
        <Kpi label="Spend" value={fmtCost(totals.estCostUsd)} sub={`${fmtNum(totals.tokens)} tokens`} />
      </div>

      <nav className="mt-6 flex gap-1 border-b border-slate-200">
        {(
          [
            ['conversation', `Conversation (${data.conversation.length})`],
            ['documents', `Documents (${data.documents.length})`],
            ['history', 'Access history'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === key
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-5">
        {tab === 'conversation' && <Conversation data={data} />}
        {tab === 'documents' && <Documents data={data} />}
        {tab === 'history' && <History events={data.accessEvents} />}
      </div>

      {extending && (
        <ExtendDialog
          link={link}
          onClose={() => setExtending(false)}
          onExtended={() => {
            setExtending(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}

function Conversation({ data }: { data: LinkDetail }) {
  if (data.conversation.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">Nothing was asked yet.</p>
  }
  return (
    <div className="space-y-4">
      {data.conversation.map((q) => (
        <article key={q.queryId} className="flex gap-4">
          <div className="w-16 shrink-0 pt-0.5 text-right font-mono text-[11px] text-slate-400">
            {timeAgo(q.ts)}
          </div>
          <div
            className={`min-w-0 flex-1 border-l-2 pl-4 ${
              q.grounded ? 'border-slate-200' : 'border-amber-400'
            }`}
          >
            <h3 className="text-sm font-medium text-slate-900">{q.question}</h3>
            <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-slate-600">{q.answer}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Badge tone={q.grounded ? 'indigo' : 'amber'}>
                {q.grounded ? 'answered' : 'declined'}
              </Badge>
              <Badge tone="slate">
                <span className="font-mono">{fmtMs(q.totalMs)}</span>
              </Badge>
              <Badge tone="slate">
                <span className="font-mono">{fmtNum(q.tokens)} tokens</span>
              </Badge>
              {q.feedback === 'like' && <Badge tone="green">👍 helpful</Badge>}
              {q.feedback === 'dislike' && (
                <Badge tone="red">👎 {q.feedbackReason || 'no reason given'}</Badge>
              )}
              <Link
                to={`/admin/queries/${q.queryId}`}
                className="ml-auto text-xs text-indigo-600 hover:underline"
              >
                Inspect retrieval →
              </Link>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

function Documents({ data }: { data: LinkDetail }) {
  if (data.documents.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">Nothing was uploaded.</p>
  }
  return (
    <div className="space-y-2">
      {data.documents.map((d) => (
        <div
          key={d.docId}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3"
        >
          <span className="min-w-40 flex-1 text-sm font-medium text-slate-800">{d.filename}</span>
          <span className="font-mono text-xs text-slate-500">
            {fmtBytes(d.sizeBytes)} · {fmtNum(d.chunkCount)} chunks
            {d.pageCount ? ` · ${d.pageCount} pages` : ''} · {fmtMs(d.totalMs)}
          </span>
          <Badge tone={d.status === 'ready' ? 'green' : d.status === 'failed' ? 'red' : 'slate'}>
            {d.status === 'ready' ? 'indexed' : d.status}
          </Badge>
          <a
            href={`/viewer/${d.docId}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-indigo-600 hover:underline"
          >
            Preview ↗
          </a>
        </div>
      ))}
    </div>
  )
}

const EVENT_COPY: Record<AccessEvent['kind'], string> = {
  minted: 'Link minted',
  extended: 'Window extended',
  revoked: 'Link revoked',
  reinstated: 'Link reinstated',
  requested: 'Extension requested',
  declined: 'Request declined',
}

function History({ events }: { events: AccessEvent[] }) {
  if (events.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">No changes recorded.</p>
  }
  return (
    <ol className="space-y-3.5">
      {events.map((e, i) => (
        <li key={i} className="flex gap-3">
          <span
            className={`mt-1.5 size-2 shrink-0 rounded-full ${
              e.kind === 'requested'
                ? 'bg-amber-500'
                : e.kind === 'revoked' || e.kind === 'declined'
                  ? 'bg-red-400'
                  : 'bg-indigo-500'
            }`}
          />
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900">{EVENT_COPY[e.kind]}</div>
            <div className="text-xs text-slate-500">
              by {e.actor} · {fmtDateTime(e.ts)}
              {e.note && <> · “{e.note}”</>}
            </div>
            {e.expiresAfter && (
              <div className="font-mono text-[11px] text-slate-400">
                {e.expiresBefore && <>was {fmtDateTime(e.expiresBefore)} → </>}
                {fmtDateTime(e.expiresAfter)}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
