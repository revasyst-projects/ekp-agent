import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminDashboard, adminListLinks, adminListQueries } from '../../api/client'
import type { DashboardData, Feedback, ProposalLink, QuerySummary } from '../../api/types'
import { Badge, Card, InfoTip, Kpi, Spinner } from '../../components/ui'
import { fmtCost, fmtDay, fmtMs, fmtNum, timeAgo } from '../../utils/format'

const PERIODS = [
  { days: 7, label: 'Last 7 days' },
  { days: 14, label: 'Last 14 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 365, label: 'Last year' },
]

export default function DashboardPage() {
  const [days, setDays] = useState(14)
  const [linkId, setLinkId] = useState('')
  const [data, setData] = useState<DashboardData | null>(null)
  const [links, setLinks] = useState<ProposalLink[]>([])

  useEffect(() => {
    adminListLinks().then(setLinks).catch(() => {})
  }, [])

  useEffect(() => {
    setData(null)
    adminDashboard(days, linkId || undefined).then(setData)
  }, [days, linkId])

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
        <Spinner /> Loading analytics…
      </div>
    )
  }

  const { totals } = data

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Analytics</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Every question and ingestion across all links.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none"
        >
          {PERIODS.map((p) => (
            <option key={p.days} value={p.days}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          value={linkId}
          onChange={(e) => setLinkId(e.target.value)}
          className="min-w-52 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none"
        >
          <option value="">All links</option>
          {links.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Questions" value={fmtNum(totals.queries)} sub={`over ${data.days} days`} />
        <Kpi
          label="Grounded"
          value={`${totals.groundedPct}%`}
          sub={`${totals.refused} declined`}
        />
        <Kpi label="Median answer" value={fmtMs(totals.p50Ms)} sub={`p90 ${fmtMs(totals.p90Ms)}`} />
        <Kpi label="Documents" value={fmtNum(totals.ingestions)} sub={`${fmtNum(totals.chunks)} chunks`} />
        <Kpi label="Tokens" value={fmtNum(totals.tokens)} sub="embeddings in-house" />
        <Kpi
          label="LLM spend"
          value={fmtCost(totals.estCostUsd)}
          sub={totals.queries ? `${fmtCost(totals.estCostUsd / totals.queries)} / question` : undefined}
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-4">
        <VolumeChart series={data.series} />
        <OutcomeCard totals={totals} />
      </div>

      <QuestionList days={days} linkId={linkId} />

      <div className="mt-5 flex flex-wrap gap-4">
        <Card className="min-w-0 flex-1 basis-80 p-5">
          <h2 className="font-medium text-slate-900">What the corpus could not answer</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {totals.refused} refusal{totals.refused === 1 ? '' : 's'} — the gaps worth filling
            before the next demo.
          </p>
          <ul className="mt-3.5 space-y-2.5">
            {data.refusals.length === 0 && (
              <li className="text-sm text-slate-400">Nothing was declined in this period.</li>
            )}
            {data.refusals.slice(0, 6).map((r) => (
              <li key={r.queryId}>
                <Link
                  to={`/admin/queries/${r.queryId}`}
                  className="block text-sm text-slate-700 hover:text-indigo-700"
                >
                  {r.question}
                </Link>
                <span className="font-mono text-[11px] text-slate-400">
                  {r.linkLabel} · {timeAgo(r.ts)}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="min-w-0 flex-1 basis-80 p-5">
          <h2 className="font-medium text-slate-900">Thumbs down, with the reason</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {totals.dislikes} of {totals.likes + totals.dislikes} rated answers.
          </p>
          <ul className="mt-3.5 space-y-2.5">
            {data.complaints.length === 0 && (
              <li className="text-sm text-slate-400">No complaints in this period.</li>
            )}
            {data.complaints.slice(0, 6).map((c) => (
              <li key={c.queryId}>
                <Link
                  to={`/admin/queries/${c.queryId}`}
                  className="block text-sm text-slate-700 hover:text-indigo-700"
                >
                  {c.reason ? `“${c.reason}”` : <span className="italic">No reason given</span>}
                </Link>
                <span className="font-mono text-[11px] text-slate-400">
                  {c.linkLabel} · {c.question.slice(0, 48)}
                  {c.question.length > 48 ? '…' : ''} · {timeAgo(c.ts)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

/** Single series, so no legend — the title names it. */
function VolumeChart({ series }: { series: DashboardData['series'] }) {
  const max = Math.max(1, ...series.map((s) => s.queries))
  const total = series.reduce((n, s) => n + s.queries, 0)

  return (
    <Card className="min-w-0 flex-[2] basis-[28rem] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium text-slate-900">Questions per day</h2>
        <span className="text-xs text-slate-400">{fmtNum(total)} total</span>
      </div>

      <div className="mt-5 pl-9">
        <div className="relative h-40 border-b border-slate-200">
          <div className="absolute -left-9 top-0 flex h-40 w-8 flex-col justify-between text-right font-mono text-[11px] text-slate-400">
            <span>{max}</span>
            <span>{Math.round(max / 2)}</span>
            <span>0</span>
          </div>
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-slate-200" />
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-slate-200" />
          <div className="absolute inset-0 flex items-end gap-1.5">
            {series.map((s) => (
              <div key={s.day} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                {s.queries === max && s.queries > 0 && (
                  <span className="mb-1 text-center font-mono text-[11px] text-slate-600">
                    {s.queries}
                  </span>
                )}
                <div
                  title={`${fmtDay(s.day)}: ${s.queries} question${s.queries === 1 ? '' : 's'}${
                    s.refused ? `, ${s.refused} declined` : ''
                  }`}
                  className="w-full rounded-t bg-indigo-600"
                  style={{ height: `${(s.queries / max) * 100}%` }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {series.map((s, i) => (
            <span
              key={s.day}
              className="min-w-0 flex-1 truncate text-center font-mono text-[10px] text-slate-400"
            >
              {i % Math.ceil(series.length / 7) === 0 ? fmtDay(s.day) : ''}
            </span>
          ))}
        </div>
      </div>
    </Card>
  )
}

function OutcomeCard({ totals }: { totals: DashboardData['totals'] }) {
  const answered = totals.grounded
  const refused = totals.refused
  const sum = Math.max(1, answered + refused)

  return (
    <Card className="min-w-0 flex-1 basis-72 p-5">
      <h2 className="flex items-center gap-1 font-medium text-slate-900">
        Did it answer?
        <InfoTip title="Refusals are the feature">
          When nothing retrieved clears the similarity floor the platform declines instead of
          guessing. A refusal is the grounding check working.
        </InfoTip>
      </h2>

      <div className="mt-4 flex h-6 overflow-hidden rounded-md bg-slate-200">
        <div
          title={`Answered with sources: ${answered}`}
          className="rounded-l-md bg-indigo-600"
          style={{ width: `${(answered / sum) * 100}%` }}
        />
        <span className="w-0.5 bg-white" />
        <div
          title={`Declined, below the floor: ${refused}`}
          className="flex-1 rounded-r-md bg-amber-700"
        />
      </div>

      <dl className="mt-4 space-y-2.5">
        <Row color="bg-indigo-600" label="Answered with sources" value={answered} />
        <Row color="bg-amber-700" label="Declined — below the floor" value={refused} />
      </dl>

      <div className="mt-4 border-t border-slate-200 pt-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
          Answer latency
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-3">
          <Percentile label="p50" ms={totals.p50Ms} />
          <Percentile label="p90" ms={totals.p90Ms} />
          <Percentile label="p99" ms={totals.p99Ms} />
        </div>
      </div>
    </Card>
  )
}

function Row({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`size-2.5 shrink-0 rounded-sm ${color}`} />
      <dt className="flex-1 text-sm text-slate-600">{label}</dt>
      <dd className="font-mono text-sm font-medium text-slate-900">{fmtNum(value)}</dd>
    </div>
  )
}

function Percentile({ label, ms }: { label: string; ms: number }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-mono text-base font-medium text-slate-800">{fmtMs(ms)}</div>
    </div>
  )
}

/** The searchable question list — the way into every per-answer drill-down. */
function QuestionList({ days, linkId }: { days: number; linkId: string }) {
  const [rows, setRows] = useState<QuerySummary[] | null>(null)
  const [search, setSearch] = useState('')
  const [only, setOnly] = useState<'all' | 'refused' | 'dislike'>('all')

  const filters = useMemo(
    () => ({
      days,
      linkId: linkId || undefined,
      q: search.trim() || undefined,
      grounded: only === 'refused' ? false : undefined,
      feedback: (only === 'dislike' ? 'dislike' : undefined) as Feedback | undefined,
    }),
    [days, linkId, search, only],
  )

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      adminListQueries(filters)
        .then((r) => !cancelled && setRows(r))
        .catch(() => {})
    }, 200) // debounce the search box
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [filters])

  return (
    <Card className="mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="font-medium text-slate-900">Questions asked</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Open one to see the answer, the chunks behind it and what was thrown away.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions and answers"
            className="min-w-52 rounded-full border border-slate-300 px-4 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
          />
          {(
            [
              ['all', 'All'],
              ['refused', 'Refusals'],
              ['dislike', 'Thumbs down'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setOnly(key)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                only === key
                  ? 'border-indigo-500 bg-indigo-50 font-medium text-indigo-700'
                  : 'border-slate-300 text-slate-600 hover:border-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead>
            <tr className="border-y border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5 font-medium">Question</th>
              <th className="px-4 py-2.5 text-right font-medium">Latency</th>
              <th className="px-4 py-2.5 font-medium">Outcome</th>
              <th className="px-4 py-2.5 font-medium">Feedback</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                  Nothing matches.
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.queryId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="max-w-md px-4 py-3">
                  <Link
                    to={`/admin/queries/${r.queryId}`}
                    className="block truncate text-slate-800 hover:text-indigo-700"
                  >
                    {r.question}
                  </Link>
                  <span className="font-mono text-[11px] text-slate-400">
                    {r.linkLabel} · {timeAgo(r.ts)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-slate-600">
                  {fmtMs(r.totalMs)}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={r.grounded ? 'indigo' : 'amber'}>
                    {r.grounded ? 'answered' : 'declined'}
                  </Badge>
                </td>
                <td className="max-w-56 px-4 py-3">
                  {r.feedback === 'like' ? (
                    <span title="Helpful">👍</span>
                  ) : r.feedback === 'dislike' ? (
                    <span className="flex items-center gap-1.5">
                      👎
                      <span className="truncate text-xs text-red-600" title={r.feedbackReason ?? ''}>
                        {r.feedbackReason || 'no reason given'}
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
