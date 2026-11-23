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

interface ChatgptState {
  status: 'off' | 'starting' | 'on' | 'error'
  url: string
  /** true when the link stays the same after a restart (ngrok static domain) */
  stable: boolean
  error: string
  /** the link to paste into ChatGPT (only while status is 'on') */
  connectorUrl: string
}

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
    chatgptState(): Promise<ChatgptState>
    chatgptConnect(): Promise<ChatgptState>
    chatgptDisconnect(): Promise<ChatgptState>
    onChatgpt(cb: (s: ChatgptState) => void): () => void
    onRebuildProgress(cb: (line: string) => void): () => void
    onRebuildDone(cb: (code: number | null) => void): () => void
  }
}
