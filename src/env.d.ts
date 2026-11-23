// window.api type declarations (set by electron/preload.ts)
interface ApiResult<T = any> { ok: boolean; status: number; data?: T; error?: string }

interface AppStatus {
  phase: 'starting' | 'ready' | 'error'
  detail: string
  error: string
  api: boolean
  mcp: boolean
  rebuilding: boolean
  slow: boolean
  /** the server's address when the chats are stored there, else '' */
  server: string
}

interface AdvancedInfo {
  token: string; dataFolder: string; db: string; claudeCode: string; mcpConfig: string; version: string
  /** the server's address in server mode, else '' */
  server: string
}

interface WebLinkState {
  status: 'off' | 'starting' | 'on' | 'error'
  url: string
  /** true when the link stays the same after a restart (ngrok static domain) */
  stable: boolean
  error: string
  /** link with the token inside, for ChatGPT / claude.ai connectors (only while status is 'on') */
  connectorUrl: string
  /** link without the token, for apps that send `Authorization: Bearer <token>` */
  plainUrl: string
  /** e.g. "15.0" when this Mac's macOS is too old for the link, else "" */
  needsMacos: string
  /** this Mac's macOS version */
  macos: string
  /** true in server mode: the link is the server itself (always on, no tunnel) */
  server: boolean
}

type AiProviderId = 'groq' | 'xai'
interface AiConfig {
  provider: AiProviderId | null
  model: string
  hasKey: boolean
  /** last characters of the saved key, e.g. "…a1b2" (the key itself never reaches the window) */
  keyHint: string
  providers: { id: AiProviderId; name: string; keyUrl: string; note: string }[]
}
interface AskSource { n: number; conversation_id: string; title: string; updated: string; project: string; message_idx: number }
type AskEvent = { id: string } & (
  | { type: 'sources'; sources: AskSource[] }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; error: string }
)

interface StorageInfo {
  mode: 'local' | 'server'
  server: string
  /** whether this Mac still holds a copy of the database */
  hasLocalCopy: boolean
  /** size of the local database + saved exports, in MB */
  dataMB: number
  /** size of the smart-search model on this Mac, in MB */
  modelMB: number
}
type ServerCheck = { ok: true; url: string; chats: number } | { ok: false; error: string }
type MoveEvent =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: { chats: number; imported: number; already_there: number; groups: number; verified: number }; extensionInstalled: boolean }
  | { type: 'error'; error: string }

interface Window {
  api?: {
    request<T = any>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<ApiResult<T>>
    getStatus(): Promise<AppStatus>
    onStatus(cb: (s: AppStatus) => void): () => void
    retryStart(): Promise<void>
    openInChatGPT(id: string): Promise<void>
    openUrl(url: string): Promise<void>
    extensionInfo(): Promise<{ folder: string; installed: boolean }>
    extensionPrepare(): Promise<string>
    extensionReveal(): Promise<void>
    openChromeExtensions(): Promise<boolean>
    claudeDesktopState(): Promise<'not-installed' | 'connected' | 'not-connected' | 'server'>
    claudeDesktopConnect(): Promise<{ ok: boolean; error?: string }>
    getLoginItem(): Promise<{ enabled: boolean; available: boolean }>
    setLoginItem(on: boolean): Promise<boolean>
    getAdvanced(): Promise<AdvancedInfo>
    openDataFolder(): Promise<string>
    openLogs(): Promise<string>
    rebuildIndex(): void
    webLinkState(): Promise<WebLinkState>
    webLinkConnect(): Promise<WebLinkState>
    webLinkDisconnect(): Promise<WebLinkState>
    onWebLink(cb: (s: WebLinkState) => void): () => void
    storageInfo(): Promise<StorageInfo>
    serverTest(url: string, token: string): Promise<ServerCheck>
    serverMove(url: string, token: string): Promise<{ ok: true } | { ok: false; error: string }>
    serverConnect(url: string, token: string): Promise<{ ok: true; chats: number; extensionInstalled: boolean } | { ok: false; error: string }>
    serverDisconnect(): Promise<{ ok: true; extensionInstalled: boolean } & Omit<StorageInfo, 'mode' | 'server'>>
    freeLocalSpace(): Promise<{ ok: true; freedMB: number } | { ok: false; error: string }>
    onMoveEvent(cb: (ev: MoveEvent) => void): () => void
    aiGet(): Promise<AiConfig>
    aiTest(provider: AiProviderId, key?: string): Promise<{ ok: true; models: string[] } | { ok: false; error: string }>
    aiSave(c: { provider: AiProviderId; key?: string; model: string }): Promise<{ ok: true; config: AiConfig } | { ok: false; error: string }>
    aiClear(): Promise<AiConfig>
    askStart(id: string, history: { role: 'user' | 'assistant'; content: string }[]): void
    askCancel(id: string): void
    onAskEvent(cb: (ev: AskEvent) => void): () => void
    onRebuildProgress(cb: (line: string) => void): () => void
    onRebuildDone(cb: (code: number | null) => void): () => void
  }
}
