import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { fetchDefaultCorpus, getLinkInfo, type DefaultCorpusDoc } from '../../api/client'
import type { Corpus, DocIngestStats, LinkInfo } from '../../api/types'
import { Logo, Meter, Spinner } from '../../components/ui'
import { expiryText, fmtDateTime, fmtNum } from '../../utils/format'
import Blocked from './Blocked'
import IngestPanel from './IngestPanel'
import QueryPanel from './QueryPanel'

/**
 * The workspace: one surface instead of a landing page, a panel stack and a
 * separate viewer tab. The rail carries everything that is *about* the
 * session — corpus, documents, budgets, expiry — so the centre column is only
 * ever the conversation.
 */
export default function Workspace() {
  const { token = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const mode: Corpus = params.get('mode') === 'user' ? 'user' : 'default'
  const seedQuestion = params.get('q') ?? ''

  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [userDocs, setUserDocs] = useState<DocIngestStats[]>([])
  const [defaultDocs, setDefaultDocs] = useState<DefaultCorpusDoc[]>([])
  const [showUpload, setShowUpload] = useState(false)

  const refreshInfo = useCallback(() => {
    getLinkInfo(token)
      .then(setInfo)
      .catch(() => setBlocked(true))
  }, [token])

  useEffect(refreshInfo, [refreshInfo])

  useEffect(() => {
    fetchDefaultCorpus().then(setDefaultDocs).catch(() => {})
  }, [])

  // the upload panel is only in the way once documents are in
  useEffect(() => {
    if (mode === 'user' && userDocs.length === 0) setShowUpload(true)
  }, [mode, userDocs.length])

  if (blocked) return <Blocked reason="invalid" />

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

  const docs =
    mode === 'user'
      ? userDocs.map((d) => ({
          key: d.docId,
          filename: d.filename,
          detail: `${fmtNum(d.chunkCount)} chunks`,
        }))
      : defaultDocs.map((d) => ({
          key: d.docId,
          filename: d.filename,
          detail: 'pre-indexed',
        }))

  return (
    <div className="flex min-h-screen flex-wrap items-stretch bg-slate-50">
      {/* --------------------------------------------------------- rail */}
      <aside className="flex min-w-0 max-w-[21rem] flex-1 basis-72 flex-col gap-7 border-r border-slate-200 bg-white px-6 pb-7 pt-6">
        <Link to={`/p/${token}`} className="flex items-center gap-2.5">
          <Logo className="size-8" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900">Knowledge workspace</div>
            <div className="truncate text-xs text-slate-500">{info.label}</div>
          </div>
        </Link>

        <div>
          <RailLabel>Corpus</RailLabel>
          <div className="mt-2 flex rounded-full border border-slate-200 bg-slate-50 p-1 text-sm font-medium">
            {(
              [
                ['default', 'Demo corpus'],
                ['user', 'Your files'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setParams({ mode: m })}
                className={`flex-1 rounded-full px-3 py-1.5 transition ${
                  mode === m ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <RailLabel>
              {docs.length} document{docs.length === 1 ? '' : 's'} indexed
            </RailLabel>
          </div>

          {docs.length === 0 ? (
            <p className="text-xs leading-relaxed text-slate-500">
              Nothing uploaded yet — add a file and it is indexed into a namespace tied to this
              link alone.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {docs.map((d) => (
                <div
                  key={d.key}
                  className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
                >
                  <FileTag filename={d.filename} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-800">{d.filename}</span>
                    <span className="font-mono text-[11px] text-slate-400">{d.detail}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {mode === 'user' && !showUpload && (
            <button
              onClick={() => setShowUpload(true)}
              className="rounded-lg bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
            >
              Add more documents
            </button>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-4">
          <div>
            <RailLabel>What this link allows</RailLabel>
            <Budget
              className="mt-3.5"
              label="Questions"
              used={info.usedQueries}
              max={info.maxQueries}
            />
            <Budget
              className="mt-4"
              label="Uploads"
              used={info.usedIngestions}
              max={info.maxIngestions}
            />
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-xs font-medium text-emerald-800">Access {expiry.text}</div>
            <div className="mt-0.5 text-[11px] text-emerald-700/90">
              Until {fmtDateTime(info.expiresAt)}
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-400">
            Parsed and embedded on this box. Only the final answer call leaves it.
          </p>
        </div>
      </aside>

      {/* ------------------------------------------------- conversation */}
      <main className="flex min-w-0 flex-[999] basis-[37.5rem] flex-col">
        {mode === 'user' && showUpload && (
          <div className="border-b border-slate-200 bg-white px-9 py-6">
            <IngestPanel
              token={token}
              docs={userDocs}
              onIngested={(ingested) => {
                setUserDocs((prev) => [...prev, ...ingested])
                refreshInfo()
                if (ingested.length) setShowUpload(false)
              }}
              onDismiss={userDocs.length > 0 ? () => setShowUpload(false) : undefined}
            />
          </div>
        )}

        <QueryPanel
          key={mode} // a separate conversation per corpus
          token={token}
          corpus={mode}
          hasDocs={mode === 'default' || userDocs.length > 0}
          remaining={info.maxQueries - info.usedQueries}
          seedQuestion={seedQuestion}
          onQueryDone={refreshInfo}
        />
      </main>
    </div>
  )
}

function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
      {children}
    </span>
  )
}

function Budget({
  label,
  used,
  max,
  className = '',
}: {
  label: string
  used: number
  max: number
  className?: string
}) {
  const left = Math.max(0, max - used)
  const pct = max === 0 ? 0 : (used / max) * 100
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs text-slate-600">{label}</span>
        <span className="font-mono text-xs text-slate-500">
          <strong className="text-slate-900">{left}</strong> of {max} left
        </span>
      </div>
      <Meter pct={pct} tone={left === 0 ? 'red' : pct > 80 ? 'amber' : 'indigo'} />
    </div>
  )
}

export function FileTag({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const label = ext === 'pdf' ? 'PDF' : ext === 'md' ? 'MD' : ext === 'docx' ? 'DOC' : 'TXT'
  const tone =
    ext === 'pdf'
      ? 'bg-red-50 text-red-700'
      : ext === 'md'
        ? 'bg-indigo-50 text-indigo-700'
        : 'bg-slate-100 text-slate-500'
  return (
    <span className={`mt-0.5 rounded px-1.5 py-px font-mono text-[10px] font-semibold ${tone}`}>
      {label}
    </span>
  )
}
