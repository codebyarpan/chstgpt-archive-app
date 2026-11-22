// All Ingest API calls go through the Electron main process (window.api.request),
// which adds the Bearer token and avoids browser CORS restrictions.

export interface Group { id: number; name: string; count: number }
export interface Project { name: string; count: number }
export interface ConversationRow {
  conversation_id: string; title: string; project: string; updated: string
  message_count: number; groups: string
}
export interface Message { idx: number; role: string; text: string }
export interface Conversation {
  conversation_id: string; title: string; project: string; created: string; updated: string
  message_count: number; groups: { id: number; name: string }[]; messages: Message[]
}
export interface SearchHit {
  conversation_id: string; title: string; project: string; updated: string
  message_idx: number; role: string; snippet: string; match: 'keywords' | 'meaning' | 'both'
}
export interface Stats {
  conversations: number; messages: number; groups: number; projects: number
  chunks: number; embedded_chunks: number; db_size_mb: number; last_updated: string
  embedding: { running: boolean; last_error: string | null }
  extension_last_seen: number | null; semantic_ready: boolean
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (!window.api) throw new ApiError('Not running inside the desktop app', 0)
  const r = await window.api.request<T>(method, path, body)
  if (!r.ok) throw new ApiError(r.error || `Something went wrong (${r.status})`, r.status)
  return r.data as T
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const api = {
  stats: () => call<Stats>('GET', '/stats'),
  groups: () => call<Group[]>('GET', '/groups'),
  projects: () => call<Project[]>('GET', '/projects'),
  createGroup: (name: string) => call<Group>('POST', '/groups', { name }),
  renameGroup: (id: number, name: string) => call<Group>('POST', `/groups/${id}/rename`, { name }),
  deleteConversation: (id: string) => call('DELETE', `/conversations/${encodeURIComponent(id)}`),
  deleteGroup: (id: number) => call<{ deleted: number }>('DELETE', `/groups/${id}`),
  addToGroup: (groupId: number, conversationId: string) =>
    call('POST', `/groups/${groupId}/conversations`, { conversation_id: conversationId }),
  removeFromGroup: (groupId: number, conversationId: string) =>
    call('DELETE', `/groups/${groupId}/conversations/${encodeURIComponent(conversationId)}`),
  conversations: (p: { q?: string; group?: string; project?: string; limit?: number; offset?: number } = {}) =>
    call<{ total: number; results: ConversationRow[] }>('GET', `/conversations${qs(p)}`),
  conversation: (id: string) => call<Conversation>('GET', `/conversations/${encodeURIComponent(id)}`),
  search: (p: { q: string; group?: string; project?: string; limit?: number }) =>
    call<{ total: number; results: SearchHit[]; semantic: boolean }>('GET', `/search${qs(p)}`)
}

/** "(no project)" is how the archive stores chats outside a ChatGPT project. */
export const NO_PROJECT = '(no project)'
export const projectLabel = (p: string) => (p === NO_PROJECT ? '' : p)

/** "2026-11-20" → "20 Nov 2026" */
export function niceDate(d: string): string {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
