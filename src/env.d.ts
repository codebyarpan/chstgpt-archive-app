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
}

interface AdvancedInfo {
  token: string; dataFolder: string; db: string; claudeCode: string; mcpConfig: string; version: string
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
    claudeDesktopState(): Promise<'not-installed' | 'connected' | 'not-connected'>
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
