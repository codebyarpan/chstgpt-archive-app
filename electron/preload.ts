import { contextBridge, ipcRenderer } from 'electron'

function subscribe<T>(channel: string, cb: (value: T) => void) {
  const handler = (_: Electron.IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}

contextBridge.exposeInMainWorld('api', {
  request: (method: string, path: string, body?: unknown) => ipcRenderer.invoke('api', method, path, body),
  getStatus: () => ipcRenderer.invoke('get-status'),
  onStatus: (cb: (s: unknown) => void) => subscribe('status', cb),
  retryStart: () => ipcRenderer.invoke('retry-start'),
  openInChatGPT: (id: string) => ipcRenderer.invoke('open-in-chatgpt', id),
  openUrl: (url: string) => ipcRenderer.invoke('open-url', url),
  extensionInfo: () => ipcRenderer.invoke('extension-info'),
  extensionPrepare: () => ipcRenderer.invoke('extension-prepare'),
  extensionReveal: () => ipcRenderer.invoke('extension-reveal'),
  openChromeExtensions: () => ipcRenderer.invoke('open-chrome-extensions'),
  claudeDesktopState: () => ipcRenderer.invoke('claude-desktop-state'),
  claudeDesktopConnect: () => ipcRenderer.invoke('claude-desktop-connect'),
  getLoginItem: () => ipcRenderer.invoke('get-login-item'),
  setLoginItem: (on: boolean) => ipcRenderer.invoke('set-login-item', on),
  getAdvanced: () => ipcRenderer.invoke('get-advanced'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  openLogs: () => ipcRenderer.invoke('open-logs'),
  rebuildIndex: () => ipcRenderer.send('rebuild-index'),
  chatgptState: () => ipcRenderer.invoke('chatgpt-state'),
  chatgptConnect: () => ipcRenderer.invoke('chatgpt-connect'),
  chatgptDisconnect: () => ipcRenderer.invoke('chatgpt-disconnect'),
  onChatgpt: (cb: (s: unknown) => void) => subscribe('chatgpt', cb),
  aiGet: () => ipcRenderer.invoke('ai-get'),
  aiTest: (provider: string, key?: string) => ipcRenderer.invoke('ai-test', provider, key),
  aiSave: (c: unknown) => ipcRenderer.invoke('ai-save', c),
  aiClear: () => ipcRenderer.invoke('ai-clear'),
  askStart: (id: string, history: unknown) => ipcRenderer.send('ask-start', id, history),
  askCancel: (id: string) => ipcRenderer.send('ask-cancel', id),
  onAskEvent: (cb: (ev: unknown) => void) => subscribe('ask-event', cb),
  onRebuildProgress: (cb: (line: string) => void) => subscribe('rebuild-progress', cb),
  onRebuildDone: (cb: (code: number | null) => void) => subscribe('rebuild-done', cb)
})
