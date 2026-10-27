import { useEffect, useState } from 'react'
import { getSourceDoc } from '../../api/client'
import type { Citation, SourceDoc } from '../../api/types'
import { Badge, MatchScore, Spinner } from '../../components/ui'
import { fmtNum } from '../../utils/format'

interface Props {
  citation: Citation
  token: string
  onClose: () => void
}

/**
 * The cited passage, opened beside the answer instead of in a second browser
 * tab. Losing the conversation to read a source was the main friction in the
 * old flow.
 */
export default function SourcePanel({ citation, token, onClose }: Props) {
  const [doc, setDoc] = useState<SourceDoc | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setError(null)
    getSourceDoc(citation.docId, token)
      .then((d) => !cancelled && setDoc(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load it'))
    return () => {
      cancelled = true
    }
  }, [citation.docId, token])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="flex min-w-0 flex-[420] basis-[25rem] flex-col border-l border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 px-5 py-3.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900">{citation.filename}</div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-400">
            {citation.page ? `page ${citation.page} · ` : ''}characters{' '}
            {fmtNum(citation.charStart)}–{fmtNum(citation.charEnd)}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <a
            href={viewerUrl(citation, token)}
            target="_blank"
            rel="noreferrer"
            className="rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            Full document ↗
          </a>
          <button
            onClick={onClose}
            aria-label="Close the source panel"
            className="rounded-md px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-5 py-2.5">
        <MatchScore score={citation.score} />
        <Badge tone="slate">
          <span className="font-mono">{citation.charEnd - citation.charStart} chars</span>
        </Badge>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : !doc ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner className="size-4" /> Loading the passage…
          </div>
        ) : (
          <Passage doc={doc} citation={citation} />
        )}
      </div>

      <footer className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-[11px] text-slate-400">
        The highlight is the exact passage the answer was built from.
      </footer>
    </aside>
  )
}

/**
 * Pages are joined by a blank line and character offsets run across the whole
 * document, so the highlight is sliced out of the joined text — the same
 * arithmetic the ingestion pipeline used when it recorded the offsets.
 */
function Passage({ doc, citation }: { doc: SourceDoc; citation: Citation }) {
  const full = doc.pages.map((p) => p.text).join('\n\n')
  const start = Math.max(0, Math.min(citation.charStart, full.length))
  const end = Math.max(start, Math.min(citation.charEnd, full.length))

  // enough on either side to read the passage in context, not the whole file
  const CONTEXT = 700
  const before = full.slice(Math.max(0, start - CONTEXT), start)
  const highlight = full.slice(start, end)
  const after = full.slice(end, end + CONTEXT)

  return (
    <p className="whitespace-pre-wrap text-sm leading-7 text-slate-500">
      {start > CONTEXT && <span className="text-slate-300">…</span>}
      {before}
      <mark className="rounded-sm bg-amber-200 text-slate-900 shadow-[0_0_0_3px_#fde68a]">
        {highlight}
      </mark>
      {after}
      {end + CONTEXT < full.length && <span className="text-slate-300">…</span>}
    </p>
  )
}

function viewerUrl(c: Citation, token: string): string {
  const params = new URLSearchParams({ start: String(c.charStart), end: String(c.charEnd) })
  if (c.page) params.set('page', String(c.page))
  if (token) params.set('t', token)
  return `/viewer/${c.docId}?${params}`
}
