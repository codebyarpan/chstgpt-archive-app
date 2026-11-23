// "Ask AI": a chatbot that answers from the user's saved chats.
//
// For each question the archive's own search (keywords + meaning) picks the
// best passages; they go, numbered, to the AI service the user chose (Groq or
// xAI Grok, both OpenAI-compatible), and the answer streams back with [n]
// citations that link to the saved chats. The API key lives only in the main
// process (never sent to the window), in a file readable by this user only.
import { app, ipcMain, WebContents } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, unlinkSync } from 'fs'
import log from 'electron-log'

export const PROVIDERS = {
  groq: {
    name: 'Groq', base: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys',
    note: 'Has a free plan. Runs open models such as Llama and gpt-oss.',
    prefer: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant']
  },
  xai: {
    name: 'xAI Grok', base: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai',
    note: "xAI's Grok models. Paid, billed by xAI.",
    prefer: [] as string[]
  }
} as const
export type ProviderId = keyof typeof PROVIDERS
const isProvider = (p: unknown): p is ProviderId => typeof p === 'string' && p in PROVIDERS
// CHATGPT_ARCHIVE_AI_BASE points every provider at another OpenAI-compatible server (automated tests).
const baseUrl = (p: ProviderId) => process.env.CHATGPT_ARCHIVE_AI_BASE || PROVIDERS[p].base

interface AiConfig { provider: ProviderId; key: string; model: string }
const configFile = () => join(app.getPath('userData'), 'ai.json')

function readConfig(): AiConfig | null {
  try {
    const c = JSON.parse(readFileSync(configFile(), 'utf8'))
    return isProvider(c.provider) && typeof c.key === 'string' && c.key ? { provider: c.provider, key: c.key, model: c.model || '' } : null
  } catch { return null }
}
function writeConfig(c: AiConfig) {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(configFile(), JSON.stringify(c, null, 2), { mode: 0o600 })
  chmodSync(configFile(), 0o600)
}

function publicConfig() {
  const c = readConfig()
  return {
    provider: c?.provider ?? null, model: c?.model ?? '', hasKey: !!c,
    keyHint: c ? `…${c.key.slice(-4)}` : '',
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, keyUrl: p.keyUrl, note: p.note }))
  }
}

// Models that cannot hold a text conversation (speech, images, safety filters, …).
const NOT_CHAT = /whisper|tts|speech|audio|transcri|embed|guard|moderation|image|imagine|vision|video|realtime|playai|orpheus|compound|safeguard/i

/** Plain-language message for an error answer from the AI service. */
function serviceError(provider: ProviderId, status: number, detail: string, model?: string): string {
  const name = PROVIDERS[provider].name
  if (status === 401 || status === 403) return `${name} did not accept the key. In Settings, check that you copied the whole key, or create a new one.`
  if (status === 429) return `${name} says too many requests were sent (free plans have a per-minute limit). Wait a minute, then try again.`
  if (status === 404 && model) return `The model "${model}" is not available any more. Pick another one in Settings → AI chatbot.`
  if (status === 413 || /context|too long|tokens/i.test(detail)) return `The question plus the found passages were too long for this model. Try a shorter question, or pick a bigger model in Settings.`
  return `${name} returned an error (${status})${detail ? `: ${detail.slice(0, 200)}` : ''}.`
}
const offline = (provider: ProviderId) => `Could not reach ${PROVIDERS[provider].name}. Please check the internet connection.`

async function errorDetail(r: Response): Promise<string> {
  const text = await r.text().catch(() => '')
  try { const j = JSON.parse(text); return j?.error?.message || j?.error || j?.detail || text } catch { return text }
}

async function listModels(provider: ProviderId, key: string): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  let r: Response
  try {
    r = await fetch(`${baseUrl(provider)}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) })
  } catch { return { ok: false, error: offline(provider) } }
  if (!r.ok) return { ok: false, error: serviceError(provider, r.status, String(await errorDetail(r))) }
  const data: any = await r.json().catch(() => null)
  const items: { id: string; created?: number }[] = (data?.data || data?.models || []).filter((m: any) => m && typeof m.id === 'string')
  const chat = items.filter(m => !NOT_CHAT.test(m.id)).sort((a, b) => (b.created || 0) - (a.created || 0)).map(m => m.id)
  const prefer = PROVIDERS[provider].prefer.filter(id => chat.includes(id))
  const models = [...prefer, ...chat.filter(id => !prefer.includes(id))]
  return models.length ? { ok: true, models } : { ok: false, error: `${PROVIDERS[provider].name} accepted the key but offers no chat models for it.` }
}

// ── Answering ───────────────────────────────────────────────────────────────
type ApiRequest = (method: 'GET', path: string) => Promise<{ ok: boolean; status: number; data?: any; error?: string }>
interface Turn { role: 'user' | 'assistant'; content: string }
export interface Source { n: number; conversation_id: string; title: string; updated: string; project: string; message_idx: number }

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + ' …' : s)
const who = (role: string) => (role === 'user' ? 'User' : role === 'assistant' ? 'ChatGPT' : 'Tool')

const SYSTEM = `You answer questions about the user's own saved ChatGPT conversations.
Use only the numbered excerpts you are given. Cite the excerpts you use like [1] or [2][3].
If the excerpts do not answer the question, say you could not find it in the saved chats and suggest other words to try. Never invent details.
In the excerpts, "User" is the person you are talking to (call them "you") and "ChatGPT" is the assistant they talked to back then.
Keep answers short, clear and in plain language. Answer in the language of the question.`

async function retrieve(apiRequest: ApiRequest, question: string, previous?: string): Promise<{ sources: Source[]; context: string }> {
  // A short follow-up ("and the price?") is searched together with the question before it.
  const q = previous && question.split(/\s+/).length < 6 ? `${previous} ${question}` : question
  const r = await apiRequest('GET', `/search?q=${encodeURIComponent(q)}&limit=6`)
  if (!r.ok) throw new Error(r.error || 'The archive search did not answer.')
  const hits: any[] = (r.data?.results || []).slice(0, 6)
  const convs = await Promise.all(hits.map(h => apiRequest('GET', `/conversations/${encodeURIComponent(h.conversation_id)}`).then(x => (x.ok ? x.data : null))))
  const sources: Source[] = []
  const blocks: string[] = []
  hits.forEach((h, i) => {
    const c = convs[i]
    const around = c ? c.messages.filter((m: any) => m.idx >= h.message_idx - 1 && m.idx <= h.message_idx + 1) : []
    const text = around.length ? around.map((m: any) => `${who(m.role)}: ${clip(m.text, 900)}`).join('\n\n') : h.snippet
    const n = i + 1
    sources.push({ n, conversation_id: h.conversation_id, title: h.title, updated: h.updated, project: h.project, message_idx: h.message_idx })
    blocks.push(`[${n}] Chat "${h.title}" (${h.updated || 'date unknown'})\n${text}`)
  })
  return { sources, context: blocks.join('\n\n---\n\n') }
}

const running = new Map<string, AbortController>()

async function answer(sender: WebContents, id: string, history: Turn[], apiRequest: ApiRequest) {
  const send = (ev: Record<string, unknown>) => { if (!sender.isDestroyed()) sender.send('ask-event', { id, ...ev }) }
  const cfg = readConfig()
  if (!cfg) return send({ type: 'error', error: 'No AI service is connected yet. Add a key in Settings → AI chatbot.' })
  const turns = history.filter(t => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim())
  const question = turns[turns.length - 1]?.content || ''
  if (!question || turns[turns.length - 1].role !== 'user') return send({ type: 'error', error: 'Please type a question.' })
  const previous = [...turns.slice(0, -1)].reverse().find(t => t.role === 'user')?.content

  const ctrl = new AbortController()
  running.set(id, ctrl)
  try {
    const { sources, context } = await retrieve(apiRequest, question, previous)
    send({ type: 'sources', sources })
    const messages = [
      { role: 'system', content: SYSTEM },
      ...turns.slice(-7, -1).map(t => ({ role: t.role, content: clip(t.content, 2000) })),
      { role: 'user', content: sources.length
        ? `Excerpts from my saved chats:\n\n${context}\n\nQuestion: ${question}`
        : `No saved chats matched this question.\n\nQuestion: ${question}` }
    ]
    let r: Response
    try {
      r = await fetch(`${baseUrl(cfg.provider)}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, messages, stream: true, temperature: 0.3 })
      })
    } catch (e: any) {
      if (ctrl.signal.aborted) return send({ type: 'done' })
      return send({ type: 'error', error: offline(cfg.provider) })
    }
    if (!r.ok || !r.body) {
      return send({ type: 'error', error: serviceError(cfg.provider, r.status, String(await errorDetail(r)), cfg.model) })
    }
    // Server-sent events: lines of "data: {json}" ending with "data: [DONE]".
    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload)
          if (j.error) return send({ type: 'error', error: serviceError(cfg.provider, 0, String(j.error.message || j.error), cfg.model) })
          const text = j.choices?.[0]?.delta?.content
          if (text) send({ type: 'delta', text })
        } catch { /* keep-alive or partial line */ }
      }
    }
    send({ type: 'done' })
  } catch (e: any) {
    if (ctrl.signal.aborted) return send({ type: 'done' })
    log.warn('[ask]', e)
    send({ type: 'error', error: e?.message || String(e) })
  } finally {
    running.delete(id)
  }
}

export function registerAi(apiRequest: ApiRequest) {
  ipcMain.handle('ai-get', () => publicConfig())
  // Checks a key (or the saved one) and lists the models it can use.
  ipcMain.handle('ai-test', (_e, provider: unknown, key?: unknown) => {
    if (!isProvider(provider)) return { ok: false, error: 'Unknown AI service' }
    const saved = readConfig()
    const k = typeof key === 'string' && key.trim() ? key.trim() : saved?.provider === provider ? saved.key : ''
    return k ? listModels(provider, k) : { ok: false, error: 'Paste your key first.' }
  })
  ipcMain.handle('ai-save', (_e, c: { provider?: unknown; key?: unknown; model?: unknown }) => {
    if (!isProvider(c?.provider) || typeof c.model !== 'string' || !c.model) return { ok: false, error: 'Pick a service and a model.' }
    const saved = readConfig()
    const key = typeof c.key === 'string' && c.key.trim() ? c.key.trim() : saved?.provider === c.provider ? saved.key : ''
    if (!key) return { ok: false, error: 'Paste your key first.' }
    writeConfig({ provider: c.provider, key, model: c.model })
    return { ok: true, config: publicConfig() }
  })
  ipcMain.handle('ai-clear', () => {
    try { if (existsSync(configFile())) unlinkSync(configFile()) } catch (e) { log.warn('ai-clear', e) }
    return publicConfig()
  })
  ipcMain.on('ask-start', (e, id: string, history: Turn[]) => {
    if (typeof id === 'string' && Array.isArray(history)) answer(e.sender, id, history, apiRequest)
  })
  ipcMain.on('ask-cancel', (_e, id: string) => running.get(id)?.abort())
}
