/**
 * API contract for the Enterprise Knowledge Platform.
 *
 * This file is the single source of truth the backend must satisfy
 * (architecture.md §3, §6). The mock layer (mock.ts) implements it today;
 * build-order step 6 swaps the mock for live fetch/SSE with no UI changes.
 */

// ---------- Proposal link ----------

export interface LinkInfo {
  token: string
  label: string
  expiresAt: string // ISO 8601
  maxIngestions: number
  usedIngestions: number
  maxQueries: number
  usedQueries: number
  revoked: boolean
  /** true once the client has asked for the window to be reopened */
  extensionRequested: boolean
}

export type Corpus = 'user' | 'default'

// ---------- Ingestion (SSE stream over POST /api/ingest) ----------

export type IngestStage = 'parse' | 'clean' | 'chunk' | 'embed' | 'index'

export interface StageMetrics {
  [key: string]: string | number
}

export interface DocStageRecord {
  stage: IngestStage
  durationMs: number
  metrics: StageMetrics
}

export interface DocIngestStats {
  docId: string
  filename: string
  sizeBytes: number
  pageCount: number | null
  wordCount: number
  chunkCount: number
  tokenCount: number
  embeddingCount: number
  vectorDim: number
  embeddingModel: string
  totalMs: number
  stages: DocStageRecord[]
}

export interface IngestAggregate {
  documents: number
  chunks: number
  tokens: number
  embeddings: number
  totalMs: number
}

export type IngestEvent =
  | { type: 'doc-start'; docId: string; filename: string; sizeBytes: number }
  | {
      type: 'stage'
      docId: string
      stage: IngestStage
      status: 'started' | 'completed'
      durationMs?: number
      metrics?: StageMetrics
    }
  | { type: 'doc-done'; docId: string; stats: DocIngestStats }
  | { type: 'done'; aggregate: IngestAggregate }
  | { type: 'error'; docId?: string; message: string }

// ---------- RAG query (SSE stream over POST /api/query) ----------

export type QueryStage = 'embed-query' | 'retrieve' | 'generate'

export interface Citation {
  id: number // renders as [1], [2], ...
  docId: string
  filename: string
  page: number | null
  charStart: number
  charEnd: number
  snippet: string
  score: number // cosine similarity 0..1
}

export interface QueryStats {
  retrievalMs: number
  ttftMs: number
  totalMs: number
  inputTokens: number
  outputTokens: number
  model: string
  estCostUsd: number
}

export type QueryEvent =
  | { type: 'stage'; stage: QueryStage; status: 'started' | 'completed'; durationMs?: number; info?: string }
  | { type: 'sources'; citations: Citation[] }
  | { type: 'token'; text: string }
  | { type: 'grounded'; grounded: boolean }
  | { type: 'followups'; questions: string[] }
  | { type: 'done'; queryId: string; stats: QueryStats }
  | { type: 'error'; message: string }

export type Feedback = 'like' | 'dislike'

// ---------- Source documents (viewer) ----------

export interface SourcePage {
  page: number
  text: string
}

export interface SourceDoc {
  docId: string
  filename: string
  kind: 'pdf' | 'text' | 'markdown'
  /** pdf: text per page; global char offsets run across pages in order */
  pages: SourcePage[]
}

// ---------- Admin ----------

export interface PendingExtension {
  id: string
  hours: number
  note: string
}

export interface ProposalLink {
  id: string
  label: string
  url: string
  createdAt: string
  expiresAt: string
  maxIngestions: number
  usedIngestions: number
  maxQueries: number
  usedQueries: number
  revoked: boolean
  documentCount: number
  lastActivityAt: string | null
  pendingExtension: PendingExtension | null
}

export interface CreateLinkRequest {
  label: string
  maxIngestions: number
  maxQueries: number
  expiresInHours: number
}

/**
 * Push a link's expiry out — `hours` from `anchor`, or straight to `expiresAt`.
 * The token never changes, so a URL already shared with a client keeps working.
 */
export interface ExtendLinkRequest {
  hours?: number
  expiresAt?: string
  anchor?: 'now' | 'current'
  topUpQueries?: number
  note?: string
  requestId?: string
}

/** The longest window the server will grant, counted from now. */
export const MAX_WINDOW_HOURS = 8760

export interface AccessEvent {
  kind: 'minted' | 'extended' | 'revoked' | 'reinstated' | 'requested' | 'declined'
  actor: 'admin' | 'client'
  note: string
  expiresBefore: string | null
  expiresAfter: string | null
  ts: string
}

/** One row of the admin question list / a link's conversation. */
export interface QuerySummary {
  queryId: string
  ts: string
  linkId: string | null
  linkLabel: string
  corpus: Corpus
  question: string
  answer: string
  grounded: boolean
  totalMs: number
  tokens: number
  estCostUsd: number
  model: string
  feedback: Feedback | null
  feedbackReason: string | null
}

export interface RetrievedChunk {
  chunkId: number
  docId: string
  filename: string
  ordinal: number
  docChunks: number
  page: number | null
  charStart: number
  charEnd: number
  tokenCount: number
  snippet: string
  rank: number
  score: number | null
  /** whether this chunk cleared the floor and reached the model */
  used: boolean
}

export interface QueryDetail extends QuerySummary {
  retrievalMs: number
  ttftMs: number
  inputTokens: number
  outputTokens: number
  similarityFloor: number
  retrievedCount: number
  keptCount: number
  askedTimes: number
  chunks: RetrievedChunk[]
}

export interface LinkDocument {
  docId: string
  filename: string
  sizeBytes: number
  pageCount: number | null
  chunkCount: number
  totalMs: number
  status: string
  ingestedAt: string
}

export interface LinkDetail {
  link: ProposalLink
  totals: {
    queries: number
    grounded: number
    tokens: number
    estCostUsd: number
    p50Ms: number
    p90Ms: number
  }
  documents: LinkDocument[]
  conversation: QuerySummary[]
  accessEvents: AccessEvent[]
}

export interface DashboardData {
  days: number
  totals: {
    activeLinks: number
    totalLinks: number
    expiringSoon: number
    pendingRequests: number
    queries: number
    grounded: number
    refused: number
    groundedPct: number
    ingestions: number
    chunks: number
    tokens: number
    estCostUsd: number
    p50Ms: number
    p90Ms: number
    p99Ms: number
    likes: number
    dislikes: number
  }
  series: { day: string; queries: number; refused: number }[]
  refusals: {
    queryId: string
    question: string
    linkLabel: string
    ts: string
    totalMs: number
  }[]
  complaints: {
    queryId: string
    question: string
    linkLabel: string
    reason: string | null
    ts: string
  }[]
}

export interface QueryListFilters {
  linkId?: string
  days?: number
  grounded?: boolean
  feedback?: Feedback
  q?: string
}
