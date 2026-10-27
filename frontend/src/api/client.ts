/**
 * Live API client — build-order step 6. Same shapes as the mock it replaced
 * (types.ts is the contract); ingestion/query stream real SSE over fetch.
 */

import type {
  Corpus,
  CreateLinkRequest,
  DashboardData,
  ExtendLinkRequest,
  Feedback,
  IngestEvent,
  LinkDetail,
  LinkInfo,
  ProposalLink,
  QueryDetail,
  QueryEvent,
  QueryListFilters,
  QuerySummary,
  SourceDoc,
} from './types'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function toError(res: Response): Promise<ApiError> {
  let message = `HTTP ${res.status}`
  try {
    const body = await res.json()
    if (typeof body.detail === 'string') message = body.detail
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, message)
}

async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw await toError(res)
  return (await res.json()) as T
}

/** POST that answers with an SSE stream; each `data:` line is one JSON event. */
async function ssePost(
  path: string,
  init: RequestInit,
  onEvent: (e: any) => void,
): Promise<void> {
  const res = await fetch(path, init)
  if (!res.ok || !res.body) {
    const err = await toError(res)
    onEvent({ type: 'error', message: err.message })
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      for (const line of frame.split('\n')) {
        if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)))
      }
    }
  }
}

// ================================================================ prospect

/** GET /api/proposal/info */
export async function getLinkInfo(token: string): Promise<LinkInfo> {
  return http<LinkInfo>(`/api/proposal/info?t=${encodeURIComponent(token)}`)
}

/** POST /api/proposal/extension-request — sent from the blocked screen */
export async function requestExtension(
  token: string,
  hours: number,
  note?: string,
): Promise<void> {
  await http('/api/proposal/extension-request', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ hours, note }),
  })
}

/** POST /api/warm — fire on link open; heats embedder + DB pool + LLM client */
export async function warm(token: string): Promise<{ status: 'ready' }> {
  return http(`/api/warm?t=${encodeURIComponent(token)}`, { method: 'POST' })
}

export interface DefaultCorpusDoc {
  docId: string
  filename: string
  kind: 'pdf' | 'text' | 'markdown'
}

/** GET /api/corpus/default */
export async function fetchDefaultCorpus(): Promise<DefaultCorpusDoc[]> {
  return http<DefaultCorpusDoc[]>('/api/corpus/default')
}

/** POST /api/ingest (multipart upload, SSE response) */
export async function ingest(
  token: string,
  files: File[],
  onEvent: (e: IngestEvent) => void,
): Promise<void> {
  const form = new FormData()
  for (const f of files) form.append('files', f, f.name)
  await ssePost(
    '/api/ingest',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
    onEvent,
  )
}

/** POST /api/query (SSE) */
export async function query(
  token: string,
  corpus: Corpus,
  question: string,
  _userDocIds: string[], // the server already knows this link's documents
  onEvent: (e: QueryEvent) => void,
): Promise<void> {
  await ssePost(
    '/api/query',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ corpus, question }),
    },
    onEvent,
  )
}

/** POST /api/feedback */
export async function sendFeedback(
  token: string,
  queryId: string,
  verdict: Feedback,
  reason?: string,
): Promise<void> {
  await http('/api/feedback', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ queryId, verdict, reason }),
  })
}

/** GET /api/source/:docId — token required for user-corpus documents */
export async function getSourceDoc(docId: string, token?: string): Promise<SourceDoc> {
  const suffix = token ? `?t=${encodeURIComponent(token)}` : ''
  return http<SourceDoc>(`/api/source/${encodeURIComponent(docId)}${suffix}`)
}

// ================================================================ admin

const ADMIN_TOKEN_KEY = 'ekp.admin.jwt'

/** POST /api/admin/login */
export async function adminLogin(username: string, password: string): Promise<void> {
  const { token } = await http<{ token: string }>('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token)
}

export function adminLogout() {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY)
}

export function isAdminAuthed(): boolean {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) !== null
}

async function adminHttp<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? ''
  try {
    return await http<T>(path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) adminLogout() // expired session
    throw e
  }
}

/** GET /api/admin/links */
export async function adminListLinks(): Promise<ProposalLink[]> {
  return adminHttp<ProposalLink[]>('/api/admin/links')
}

/** POST /api/admin/links */
export async function adminCreateLink(req: CreateLinkRequest): Promise<ProposalLink> {
  return adminHttp<ProposalLink>('/api/admin/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

/** POST /api/admin/links/:id/revoke */
export async function adminRevokeLink(id: string): Promise<void> {
  await adminHttp(`/api/admin/links/${encodeURIComponent(id)}/revoke`, { method: 'POST' })
}

/** POST /api/admin/links/:id/reinstate */
export async function adminReinstateLink(id: string): Promise<ProposalLink> {
  return adminHttp<ProposalLink>(
    `/api/admin/links/${encodeURIComponent(id)}/reinstate`,
    { method: 'POST' },
  )
}

/** POST /api/admin/links/:id/extend — same token, longer window */
export async function adminExtendLink(
  id: string,
  req: ExtendLinkRequest,
): Promise<ProposalLink> {
  return adminHttp<ProposalLink>(`/api/admin/links/${encodeURIComponent(id)}/extend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

/** POST /api/admin/requests/:id/decline */
export async function adminDeclineRequest(id: string): Promise<void> {
  await adminHttp(`/api/admin/requests/${encodeURIComponent(id)}/decline`, {
    method: 'POST',
  })
}

/** GET /api/admin/links/:id */
export async function adminLinkDetail(id: string): Promise<LinkDetail> {
  return adminHttp<LinkDetail>(`/api/admin/links/${encodeURIComponent(id)}`)
}

/** GET /api/admin/queries */
export async function adminListQueries(
  filters: QueryListFilters = {},
): Promise<QuerySummary[]> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return adminHttp<QuerySummary[]>(`/api/admin/queries${qs ? `?${qs}` : ''}`)
}

/** GET /api/admin/queries/:id — the retrieval behind one answer */
export async function adminQueryDetail(id: string): Promise<QueryDetail> {
  return adminHttp<QueryDetail>(`/api/admin/queries/${encodeURIComponent(id)}`)
}

/** GET /api/admin/dashboard */
export async function adminDashboard(
  days = 14,
  linkId?: string,
): Promise<DashboardData> {
  const params = new URLSearchParams({ days: String(days) })
  if (linkId) params.set('linkId', linkId)
  return adminHttp<DashboardData>(`/api/admin/dashboard?${params}`)
}
