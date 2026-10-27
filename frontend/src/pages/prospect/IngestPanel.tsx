import { useRef, useState } from 'react'
import { ingest } from '../../api/client'
import type { DocIngestStats, IngestAggregate, IngestStage } from '../../api/types'
import { Badge } from '../../components/ui'
import { fmtBytes, fmtMs, fmtNum } from '../../utils/format'
import { FileTag } from './Workspace'

const ACCEPTED = ['pdf', 'txt', 'md', 'docx']
const MAX_FILES = 5
const MAX_TOTAL_MB = 25
const MAX_TOTAL_BYTES = MAX_TOTAL_MB * 1024 * 1024

const PIPELINE: { key: IngestStage; label: string }[] = [
  { key: 'parse', label: 'Parse' },
  { key: 'clean', label: 'Clean' },
  { key: 'chunk', label: 'Chunk' },
  { key: 'embed', label: 'Embed' },
  { key: 'index', label: 'Index' },
]

type StageStatus = 'pending' | 'active' | 'done'

interface LiveDoc {
  docId: string
  filename: string
  sizeBytes: number
  stages: Partial<Record<IngestStage, { status: StageStatus; durationMs?: number }>>
  stats?: DocIngestStats
}

interface Props {
  token: string
  docs: DocIngestStats[]
  onIngested: (docs: DocIngestStats[]) => void
  /** only offered once there is already something to go back to */
  onDismiss?: () => void
}

/**
 * Upload and the live pipeline. The five stages are a thin rail per document
 * rather than five bordered cards: at a glance you want "which stage, how
 * long", and the counts belong to the finished document.
 */
export default function IngestPanel({ token, docs, onIngested, onDismiss }: Props) {
  const [selected, setSelected] = useState<File[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [liveDocs, setLiveDocs] = useState<LiveDoc[]>([])
  const [aggregate, setAggregate] = useState<IngestAggregate | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedBytes = selected.reduce((s, f) => s + f.size, 0)
  const slotsLeft = MAX_FILES - docs.length - selected.length
  const bytesLeft = MAX_TOTAL_BYTES - selectedBytes

  function addFiles(files: File[]) {
    const errs: string[] = []
    const accepted = [...selected]
    let total = selectedBytes
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      if (!ACCEPTED.includes(ext)) {
        errs.push(
          `${f.name} was not added — ${ext ? `.${ext} files` : 'that format'} are not parsed yet. Accepted: ${ACCEPTED.join(', ')}.`,
        )
      } else if (accepted.some((s) => s.name === f.name)) {
        errs.push(`${f.name} is already in the list.`)
      } else if (docs.length + accepted.length >= MAX_FILES) {
        errs.push(`${f.name} was skipped — this link allows ${MAX_FILES} documents in total.`)
      } else if (total + f.size > MAX_TOTAL_BYTES) {
        errs.push(`${f.name} would push the upload past the ${MAX_TOTAL_MB} MB limit.`)
      } else {
        accepted.push(f)
        total += f.size
      }
    }
    setErrors(errs)
    setSelected(accepted)
  }

  async function runIngest() {
    if (selected.length === 0 || running) return
    setRunning(true)
    setErrors([])
    setAggregate(null)
    const files = selected
    setSelected([])
    const finished: DocIngestStats[] = []

    await ingest(token, files, (e) => {
      switch (e.type) {
        case 'error':
          setErrors((prev) => [...prev, e.message])
          if (e.docId) setLiveDocs((prev) => prev.filter((d) => d.docId !== e.docId || d.stats))
          break
        case 'doc-start':
          setLiveDocs((prev) => [
            ...prev,
            { docId: e.docId, filename: e.filename, sizeBytes: e.sizeBytes, stages: {} },
          ])
          break
        case 'stage':
          setLiveDocs((prev) =>
            prev.map((d) =>
              d.docId === e.docId
                ? {
                    ...d,
                    stages: {
                      ...d.stages,
                      [e.stage]:
                        e.status === 'started'
                          ? { status: 'active' as const }
                          : { status: 'done' as const, durationMs: e.durationMs },
                    },
                  }
                : d,
            ),
          )
          break
        case 'doc-done':
          finished.push(e.stats)
          setLiveDocs((prev) => prev.map((d) => (d.docId === e.docId ? { ...d, stats: e.stats } : d)))
          break
        case 'done':
          setAggregate(e.aggregate)
          break
      }
    })

    setRunning(false)
    onIngested(finished)
  }

  const canAdd = !running && slotsLeft > 0 && bytesLeft > 0

  return (
    <div className="mx-auto max-w-[54rem]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium text-slate-900">Add documents</h2>
          <p className="mt-1 text-xs text-slate-500">
            pdf, txt, md, docx · up to {MAX_FILES} documents and {MAX_TOTAL_MB} MB per upload
          </p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            Done — back to asking
          </button>
        )}
      </div>

      {/* dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (canAdd) addFiles(Array.from(e.dataTransfer.files))
        }}
        onClick={() => canAdd && inputRef.current?.click()}
        className={`mt-4 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
          dragOver
            ? 'border-indigo-400 bg-indigo-100'
            : canAdd
              ? 'cursor-pointer border-indigo-200 bg-indigo-50 hover:border-indigo-400'
              : 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-70'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.docx"
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <UploadIcon />
        <p className="mt-2 font-medium text-slate-900">
          {canAdd ? 'Drop files here' : slotsLeft <= 0 ? 'Document limit reached' : 'Size limit reached'}
        </p>
        <p className="mt-0.5 text-sm text-slate-600">
          {canAdd
            ? `or pick them from your computer — ${slotsLeft} file${slotsLeft === 1 ? '' : 's'} and ${fmtBytes(bytesLeft)} still allowed`
            : 'Remove a file to make room, or ask about what is already indexed.'}
        </p>
        {canAdd && (
          <span className="mt-4 inline-block rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white">
            Browse files
          </span>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="mt-3 space-y-2">
          {errors.map((e, i) => (
            <li
              key={i}
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs leading-relaxed text-red-700"
            >
              {e}
            </li>
          ))}
        </ul>
      )}

      {selected.length > 0 && (
        <div className="mt-4 space-y-2">
          {selected.map((f) => (
            <div
              key={f.name}
              className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm"
            >
              <FileTag filename={f.name} />
              <span className="min-w-0 flex-1 truncate text-slate-800">{f.name}</span>
              <span className="font-mono text-xs text-slate-400">{fmtBytes(f.size)}</span>
              <button
                onClick={() => setSelected((prev) => prev.filter((x) => x.name !== f.name))}
                className="text-slate-400 transition hover:text-red-500"
                aria-label={`Remove ${f.name}`}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={runIngest}
            disabled={running}
            className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            Ingest {selected.length} document{selected.length === 1 ? '' : 's'}
          </button>
        </div>
      )}

      {liveDocs.length > 0 && (
        <div className="mt-5 space-y-3">
          {liveDocs.map((d) => (
            <DocProgress key={d.docId} doc={d} />
          ))}
        </div>
      )}

      {aggregate && (
        <div className="fade-up mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-800">
            {aggregate.documents} document{aggregate.documents === 1 ? '' : 's'} searchable now.
          </p>
          <p className="mt-1.5 font-mono text-[11px] text-emerald-700">
            {fmtNum(aggregate.chunks)} chunks · {fmtNum(aggregate.tokens)} tokens ·{' '}
            {fmtNum(aggregate.embeddings)} embeddings · {fmtMs(aggregate.totalMs)} total ·
            bge-small-en-v1.5 (onnx-int8) on local CPU
          </p>
        </div>
      )}
    </div>
  )
}

function DocProgress({ doc }: { doc: LiveDoc }) {
  const activeStage = PIPELINE.find((p) => doc.stages[p.key]?.status === 'active')

  return (
    <article className="fade-up rounded-xl border border-slate-200 bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileTag filename={doc.filename} />
          <span className="truncate text-sm font-medium text-slate-800">{doc.filename}</span>
          <span className="font-mono text-xs text-slate-400">{fmtBytes(doc.sizeBytes)}</span>
        </div>
        {doc.stats ? (
          <Badge tone="green">indexed in {fmtMs(doc.stats.totalMs)}</Badge>
        ) : (
          <Badge tone="indigo">{activeStage ? activeStage.label.toLowerCase() : 'starting'}…</Badge>
        )}
      </div>

      <div className="mt-3.5 grid grid-cols-5 gap-2">
        {PIPELINE.map((p) => {
          const s = doc.stages[p.key]
          const status = s?.status ?? 'pending'
          return (
            <div key={p.key}>
              <div
                className={`h-1.5 rounded-full ${
                  status === 'done'
                    ? 'bg-indigo-500'
                    : status === 'active'
                      ? 'animate-pulse bg-indigo-500'
                      : 'bg-slate-200'
                }`}
              />
              <div
                className={`mt-1.5 text-xs ${
                  status === 'pending' ? 'text-slate-400' : 'text-slate-600'
                }`}
              >
                {p.label}
              </div>
              <div className="font-mono text-[11px] text-slate-400">
                {s?.durationMs !== undefined ? fmtMs(s.durationMs) : '—'}
              </div>
            </div>
          )
        })}
      </div>

      {doc.stats && (
        <dl className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Chunks" value={fmtNum(doc.stats.chunkCount)} />
          <Stat label="Tokens" value={fmtNum(doc.stats.tokenCount)} />
          <Stat label="Vectors" value={`${fmtNum(doc.stats.embeddingCount)} × ${doc.stats.vectorDim}`} />
          <Stat
            label="Words"
            value={fmtNum(doc.stats.wordCount)}
            sub={doc.stats.pageCount ? `${doc.stats.pageCount} pages` : undefined}
          />
        </dl>
      )}
    </article>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-mono text-sm font-medium text-slate-800">{value}</dd>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  )
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className="mx-auto size-9 text-indigo-600"
    >
      <path
        d="M12 16V5m0 0L8 9m4-4l4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
