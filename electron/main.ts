import { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, clipboard, dialog, Notification } from 'electron'
import { join, delimiter } from 'path'
import { spawn, execFile, ChildProcess } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, cpSync, rmSync, copyFileSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { randomBytes } from 'crypto'
import log from 'electron-log'
import { registerAi } from './ai'

// A separate profile (own single-instance lock and prefs) for side-by-side testing.
if (process.env.CHATGPT_ARCHIVE_PROFILE) app.setPath('userData', process.env.CHATGPT_ARCHIVE_PROFILE)

// ── Paths ───────────────────────────────────────────────────────────────────
const HOME = homedir()
// Data: the original ~/chatgpt-archive folder if it already holds a database
// (the developer's Mac), otherwise a normal per-user app-data folder.
const LEGACY_DIR = join(HOME, 'chatgpt-archive')
// CHATGPT_ARCHIVE_HOME / _API_PORT / _MCP_PORT override these for testing.
const ARCHIVE_DIR = process.env.CHATGPT_ARCHIVE_HOME || (existsSync(join(LEGACY_DIR, 'data', 'archive.db'))
  ? LEGACY_DIR
  : join(HOME, 'Library', 'Application Support', 'ChatGPTArchive'))
const TOKEN_FILE = join(ARCHIVE_DIR, '.token')
const DB_PATH = join(ARCHIVE_DIR, 'data', 'archive.db')
const EXPORTS_DIR = join(ARCHIVE_DIR, 'exports')

// Code: the Python backend and uv ship inside the app; in development they come
// from ~/chatgpt-archive/kb and the uv on this Mac.
const KB_DIR = app.isPackaged ? join(process.resourcesPath, 'kb') : join(LEGACY_DIR, 'kb')
const INGEST_API = join(KB_DIR, 'ingest_api.py')
const MCP_SERVER = join(KB_DIR, 'server.py')
const INGEST_SCRIPT = join(KB_DIR, 'ingest.py')
const EXTENSION_SRC = app.isPackaged ? join(process.resourcesPath, 'extension') : join(app.getAppPath(), 'extension')
// Visible folder (not inside ~/Library) so it is easy to pick in Chrome's "Load unpacked".
const EXTENSION_DIR = process.env.CHATGPT_ARCHIVE_EXTENSION_DIR || join(HOME, 'ChatGPT Archive Extension')

// 127.0.0.1, not "localhost": Node may resolve localhost to ::1 while the server listens on IPv4.
const API_PORT = Number(process.env.CHATGPT_ARCHIVE_API_PORT) || 47821
const MCP_PORT = Number(process.env.CHATGPT_ARCHIVE_MCP_PORT) || 47822
const API_URL = `http://127.0.0.1:${API_PORT}`
const MCP_URL = `http://127.0.0.1:${MCP_PORT}`

// Apps started from Finder/Dock get a minimal PATH (/usr/bin:/bin:…).
const EXTRA_PATHS = ['/opt/homebrew/bin', '/usr/local/bin', join(HOME, '.local', 'bin'), join(HOME, '.cargo', 'bin')]
function findUv(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'bin', 'uv')
  for (const dir of EXTRA_PATHS) {
    const p = join(dir, 'uv')
    if (existsSync(p)) return p
  }
  return 'uv'
}
const UV = findUv()
// Packaged: always use uv's own Python 3.13 (downloaded once). Never the system
// python3, which on a Mac without developer tools pops up an install dialog,
// and not a brand-new Python that the ML libraries have no builds for yet.
const PY_ENV: Record<string, string> = app.isPackaged ? { UV_PYTHON: '3.13', UV_PYTHON_PREFERENCE: 'only-managed' } : {}
const CHILD_ENV = {
  ...process.env,
  ...PY_ENV,
  CHATGPT_ARCHIVE_HOME: ARCHIVE_DIR,
  PATH: [...EXTRA_PATHS, ...(process.env.PATH || '').split(delimiter)].filter(Boolean).join(delimiter),
  PYTHONUNBUFFERED: '1'
}

// ── Small persisted preferences ─────────────────────────────────────────────
const PREFS_FILE = join(app.getPath('userData'), 'prefs.json')
interface Prefs { initialized?: boolean; closeNoticeShown?: boolean; webLink?: boolean }
function readPrefs(): Prefs {
  try { return JSON.parse(readFileSync(PREFS_FILE, 'utf8')) } catch { return {} }
}
function writePrefs(p: Prefs) {
  try { mkdirSync(app.getPath('userData'), { recursive: true }); writeFileSync(PREFS_FILE, JSON.stringify(p, null, 2)) } catch (e) { log.warn('prefs', e) }
}

// ── Storage: on this Mac (local servers) or on the user's own server ────────
// In server mode nothing runs locally: the window, the Chrome extension and the
// connect links all use https://<server> (the deploy/ setup: API at /, MCP at /mcp).
const SERVER_FILE = join(app.getPath('userData'), 'server.json')
interface Remote { url: string; token: string }
function readRemote(): Remote | null {
  try {
    const r = JSON.parse(readFileSync(SERVER_FILE, 'utf8'))
    return typeof r.url === 'string' && r.url && typeof r.token === 'string' && r.token ? { url: r.url, token: r.token } : null
  } catch { return null }
}
function writeRemote(r: Remote | null) {
  if (!r) { if (existsSync(SERVER_FILE)) unlinkSync(SERVER_FILE); return }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(SERVER_FILE, JSON.stringify(r, null, 2), { mode: 0o600 })
  chmodSync(SERVER_FILE, 0o600)
}
let remote: Remote | null = readRemote()
const apiBase = () => remote?.url ?? API_URL
const apiToken = () => remote?.token ?? readToken()

/** "https://host" from what the person typed; plain http only for this Mac (testing). */
function normalizeServerUrl(input: string): string | null {
  let u: URL
  try { u = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`) } catch { return null }
  const local = ['127.0.0.1', 'localhost'].includes(u.hostname)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null
  return u.origin
}

// ── Globals ─────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let rebuildProc: ChildProcess | null = null

type Phase = 'starting' | 'ready' | 'error'
let phase: Phase = 'starting'
let phaseDetail = 'Starting…'
let errorMessage = ''
let startedAt = Date.now()
let apiUp = false
let mcpUp = false
let apiMisses = 0

// ── Token (created here, before either server starts, so both use the same one) ──
function ensureToken(): string {
  mkdirSync(join(ARCHIVE_DIR, 'data'), { recursive: true })
  mkdirSync(EXPORTS_DIR, { recursive: true })
  if (!existsSync(TOKEN_FILE)) {
    writeFileSync(TOKEN_FILE, randomBytes(32).toString('base64url') + '\n')
    chmodSync(TOKEN_FILE, 0o600)
  }
  return readToken()
}
function readToken(): string {
  try { return existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : '' } catch { return '' }
}

// ── Python servers (restarted with back-off if they crash) ───────────────────
interface Managed { name: string; args: string[]; proc: ChildProcess | null; restarts: number; failed: boolean; lastLine: string }
const servers: Managed[] = [
  { name: 'ingest-api', args: ['run', '--script', INGEST_API, '--port', String(API_PORT)], proc: null, restarts: 0, failed: false, lastLine: '' },
  { name: 'mcp', args: ['run', '--script', MCP_SERVER, '--http', '--port', String(MCP_PORT)], proc: null, restarts: 0, failed: false, lastLine: '' }
]
const MAX_RESTARTS = 4

/** Turn uv's progress output into a short, friendly line for the setup screen. */
function friendly(line: string): string | null {
  let m: RegExpMatchArray | null
  if ((m = line.match(/Downloading (cpython\S*)/i))) return 'Downloading Python (one time only)…'
  if ((m = line.match(/Downloading ([\w.-]+)(?: \(([\d.]+\s*\w+)\))?/))) return `Downloading ${m[1]}${m[2] ? ` (${m[2]})` : ''}…`
  if (/Installed \d+ packages?/i.test(line)) return 'Installing components…'
  if (/Resolved \d+ packages?/i.test(line)) return 'Preparing components…'
  if (/Uvicorn running|Ingest API on|MCP on/i.test(line)) return 'Almost ready…'
  return null
}

function startServer(s: Managed) {
  log.info(`[${s.name}] starting: ${UV} ${s.args.join(' ')}`)
  const proc = spawn(UV, s.args, { env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
  s.proc = proc
  const onData = (level: 'info' | 'warn') => (d: Buffer) => {
    for (const line of d.toString().split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
      log[level](`[${s.name}]`, line)
      s.lastLine = line
      const f = phase === 'starting' ? friendly(line) : null
      if (f) { phaseDetail = f; pushStatus() }
    }
  }
  proc.stdout?.on('data', onData('info'))
  proc.stderr?.on('data', onData('warn'))
  // Without an 'error' listener a failed spawn throws and crashes the app.
  proc.on('error', (err) => {
    log.error(`[${s.name}] failed to start:`, err.message)
    s.failed = true
    setError(`The app's helper program could not be started (${err.message}).`)
  })
  proc.on('exit', (code, signal) => {
    if (s.proc === proc) s.proc = null
    log.warn(`[${s.name}] exited`, code ?? signal)
    if (isQuitting || s.failed) return
    if (s.restarts < MAX_RESTARTS) {
      const delay = 2000 * 2 ** s.restarts++
      setTimeout(() => { if (!isQuitting && !s.proc) startServer(s) }, delay)
    } else {
      s.failed = true
      if (s.name === 'ingest-api') {
        setError('Setup could not be finished. Please check that this Mac is connected to the internet, then click "Try again".')
      }
    }
  })
}

function setError(msg: string) {
  if (phase === 'ready') return
  phase = 'error'
  errorMessage = msg
  pushStatus()
}

/** Stop leftovers from an earlier run (e.g. after a crash) so this copy owns the ports. */
function killStrays(includeTunnel = false): Promise<void> {
  const patterns = [`ingest_api.py --port ${API_PORT}`, `server.py --http --port ${MCP_PORT}`]
  // Only at app start: later (e.g. "Try again") the running tunnel is our own.
  if (includeTunnel) patterns.push(`cloudflared tunnel --no-autoupdate --url ${MCP_URL}`, `ngrok http .*127.0.0.1:${MCP_PORT}`)
  return new Promise((resolve) => {
    execFile('/usr/bin/pkill', ['-f', patterns.join('|')], () => setTimeout(resolve, 500))
  })
}

let pollTimer: NodeJS.Timeout | null = null
async function startServers(appStart = false) {
  phase = 'starting'
  phaseDetail = 'Starting…'
  errorMessage = ''
  startedAt = Date.now()
  pushStatus()
  if (remote) {
    // Server mode: nothing to start here, just wait for the server to answer.
    if (appStart) await killStrays(true)
    phaseDetail = 'Connecting to your server…'
    pushStatus()
    if (pollTimer) clearTimeout(pollTimer)
    pollHealth()
    return
  }
  if (!existsSync(INGEST_API) || !existsSync(MCP_SERVER)) {
    setError(`Some of the app's files are missing (${KB_DIR}). Please reinstall the app.`)
    return
  }
  if (app.isPackaged && !existsSync(UV)) {
    setError('Some of the app\'s files are missing. Please reinstall the app.')
    return
  }
  try { ensureToken() } catch (e: any) { setError(`Could not create the data folder: ${e.message}`); return }
  await killStrays(appStart)
  for (const s of servers) { s.restarts = 0; s.failed = false; startServer(s) }
  if (pollTimer) clearTimeout(pollTimer)
  pollHealth()
}

function stopServers() {
  for (const s of servers) { s.failed = true; s.proc?.kill() }
  rebuildProc?.kill()
}

async function retryStart() {
  stopServers()
  await new Promise(r => setTimeout(r, 1000))
  startServers()
}

async function isUp(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })
    return r.ok
  } catch {
    return false
  }
}

async function pollHealth() {
  // Server mode: the MCP server is the server's business (behind the same address).
  const [api, mcp] = await Promise.all([isUp(apiBase()), remote ? Promise.resolve(true) : isUp(MCP_URL)])
  const changed = api !== apiUp || mcp !== mcpUp
  apiUp = api
  mcpUp = mcp
  if (api) {
    apiMisses = 0
    servers[0].restarts = 0
    if (phase !== 'ready') { phase = 'ready'; errorMessage = ''; log.info('ready'); pushStatus() }
  } else if (phase === 'ready') {
    // One slow answer (e.g. while it is busy indexing) is not an outage: only
    // swap the whole window for the "Reconnecting…" screen after two misses in a row.
    if (++apiMisses >= 2) { phase = 'starting'; phaseDetail = 'Reconnecting…'; pushStatus() }
  } else if (phase === 'starting' && remote && Date.now() - startedAt > 20 * 1000) {
    setError(`Can't reach your archive server at ${remote.url}. Check the internet connection and that the server is running, then click "Try again".`)
  } else if (phase === 'starting' && Date.now() - startedAt > 20 * 60 * 1000) {
    setError('Setup is taking much longer than expected. Please check the internet connection, then click "Try again".')
  }
  if (mcp) servers[1].restarts = 0
  if (changed) pushStatus()
  pollTimer = setTimeout(pollHealth, phase === 'ready' && apiMisses === 0 ? 10000 : 1500)
}

function statusPayload() {
  return {
    phase, detail: phaseDetail, error: errorMessage, api: apiUp, mcp: mcpUp,
    rebuilding: !!rebuildProc, slow: !remote && phase === 'starting' && Date.now() - startedAt > 8000,
    server: remote?.url || ''
  }
}
function pushStatus() {
  updateTrayMenu()
  mainWindow?.webContents.send('status', statusPayload())
}

// ── Start at login (a LaunchAgent, so the app can start hidden in the menu bar) ──
const AGENT_LABEL = 'com.gate6.chatgpt-archive'
const AGENT_PLIST = join(HOME, 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`)
function loginItemEnabled(): boolean { return existsSync(AGENT_PLIST) }
function setLoginItem(on: boolean) {
  if (!app.isPackaged) return
  try {
    if (on) {
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      mkdirSync(join(HOME, 'Library', 'LaunchAgents'), { recursive: true })
      writeFileSync(AGENT_PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${esc(process.execPath)}</string><string>--hidden</string></array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`)
    } else if (existsSync(AGENT_PLIST)) {
      unlinkSync(AGENT_PLIST)
    }
  } catch (e) { log.warn('login item', e) }
  updateTrayMenu()
}

// ── Tray ─────────────────────────────────────────────────────────────────────
function updateTrayMenu() {
  if (!tray) return
  const state = phase === 'ready' ? '● Ready' : phase === 'error' ? '⚠ Needs attention' : '◌ Starting…'
  const menu = Menu.buildFromTemplate([
    { label: `ChatGPT Archive — ${state}`, enabled: false },
    { type: 'separator' },
    { label: 'Open ChatGPT Archive', click: showWindow },
    ...(phase === 'error' ? [{ label: 'Try again', click: retryStart }] : []),
    { type: 'separator' },
    {
      label: 'Start automatically when I log in', type: 'checkbox', checked: loginItemEnabled(),
      enabled: app.isPackaged, click: (item) => setLoginItem(item.checked)
    },
    { type: 'separator' },
    { label: 'Quit ChatGPT Archive', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
}

function resourcePath(name: string) {
  // Packaged: copied next to app.asar via extraResources. Dev: <project>/resources.
  return app.isPackaged ? join(process.resourcesPath, 'resources', name) : join(app.getAppPath(), 'resources', name)
}

function createTray() {
  const iconPath = resourcePath('trayTemplate.png')
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  if (icon.isEmpty()) tray.setTitle('Archive')
  tray.setToolTip('ChatGPT Archive')
  updateTrayMenu()
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'ChatGPT Archive',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b1120',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Automated UI tests render without a visible window.
      offscreen: !!process.env.CHATGPT_ARCHIVE_OFFSCREEN
    }
  })

  // Closing the window hides it: the app keeps running in the menu bar so the
  // Chrome extension can still save chats. A real quit is not blocked.
  mainWindow.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    mainWindow?.hide()
    app.dock?.hide()
    const prefs = readPrefs()
    if (!prefs.closeNoticeShown && Notification.isSupported()) {
      new Notification({
        title: 'ChatGPT Archive is still running',
        body: 'It keeps running in the menu bar (top right of the screen) so it can save your chats. To stop it, click its icon there and choose Quit.'
      }).show()
      writePrefs({ ...prefs, closeNoticeShown: true })
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })

  // Links in chats open in the normal browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith(process.env['ELECTRON_RENDERER_URL'] || '\0')) {
      e.preventDefault()
      if (/^https?:\/\//.test(url)) shell.openExternal(url)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow() {
  if (!mainWindow) createWindow()
  const win = mainWindow!
  if (process.env.CHATGPT_ARCHIVE_OFFSCREEN) return
  app.dock?.show()
  if (win.webContents.isLoading()) win.once('ready-to-show', () => { win.show(); win.focus() })
  else { win.show(); win.focus() }
}

// ── Rebuild ("Repair") the database from the saved copies of every chat ─────────
function rebuildIndex() {
  if (rebuildProc) return
  const send = (channel: string, payload: unknown) => mainWindow?.webContents.send(channel, payload)
  const proc = spawn(UV, ['run', '--quiet', '--script', INGEST_SCRIPT], { env: CHILD_ENV })
  rebuildProc = proc
  pushStatus()
  proc.stdout?.on('data', (d) => send('rebuild-progress', d.toString()))
  proc.stderr?.on('data', (d) => send('rebuild-progress', d.toString()))
  const finish = (code: number | null) => {
    if (rebuildProc !== proc) return
    rebuildProc = null
    send('rebuild-done', code)
    pushStatus()
  }
  proc.on('error', (err) => { send('rebuild-progress', `[error] ${err.message}\n`); finish(-1) })
  proc.on('exit', (code) => finish(code))
}

// ── Chrome extension ──────────────────────────────────────────────────────────
function extensionVersion(dir: string): string {
  try { return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).version || '' } catch { return '' }
}

/**
 * Copy the extension to ~/ChatGPT Archive Extension, paired with where the chats
 * live: this Mac's API and token, or the server's. In server mode the server's
 * origin is added to the manifest's host_permissions, so Chrome lets the
 * extension reach it without asking (Chrome reads the manifest when the
 * extension is loaded or reloaded).
 */
function installExtensionFiles(): string {
  const token = remote ? remote.token : ensureToken()
  if (existsSync(EXTENSION_DIR)) rmSync(EXTENSION_DIR, { recursive: true, force: true })
  cpSync(EXTENSION_SRC, EXTENSION_DIR, { recursive: true, filter: (src) => !/(\.DS_Store|README\.md)$/.test(src) })
  writeFileSync(join(EXTENSION_DIR, 'pairing.json'), JSON.stringify({ token, server: apiBase() }, null, 2))
  if (remote) {
    const mf = join(EXTENSION_DIR, 'manifest.json')
    const m = JSON.parse(readFileSync(mf, 'utf8'))
    m.host_permissions = [...new Set([...(m.host_permissions || []), `${remote.url}/*`])]
    writeFileSync(mf, JSON.stringify(m, null, 2))
  }
  writeFileSync(join(EXTENSION_DIR, 'READ ME.txt'),
    'This folder is the ChatGPT Archive extension for Google Chrome.\n' +
    'Please do not move or delete it: Chrome loads the extension from here.\n' +
    'To set it up, open the ChatGPT Archive app and follow "Connect Chrome".\n')
  return EXTENSION_DIR
}

/** After an app update, refresh the extension files in place (Chrome picks them up on its next start). */
function refreshExtensionIfOutdated() {
  try {
    if (existsSync(EXTENSION_DIR) && extensionVersion(EXTENSION_DIR) !== extensionVersion(EXTENSION_SRC)) {
      installExtensionFiles()
      log.info('extension files updated')
    }
  } catch (e) { log.warn('extension refresh', e) }
}

function openChromeExtensionsPage(): Promise<boolean> {
  clipboard.writeText('chrome://extensions')
  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-a', 'Google Chrome', 'chrome://extensions'], (err) => resolve(!err))
  })
}

// ── Claude Desktop ──────────────────────────────────────────────────────────
const CLAUDE_CONFIG = join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
function mcpEntry() {
  return { command: UV, args: ['run', '--quiet', '--script', MCP_SERVER], env: { CHATGPT_ARCHIVE_HOME: ARCHIVE_DIR, ...PY_ENV } }
}
/** Remove our local entry from Claude Desktop (it reads this Mac's copy, which server mode no longer uses). */
function removeClaudeDesktopEntry() {
  try {
    if (!existsSync(CLAUDE_CONFIG)) return
    const cfg = JSON.parse(readFileSync(CLAUDE_CONFIG, 'utf8'))
    if (!cfg?.mcpServers?.['chatgpt-archive']) return
    copyFileSync(CLAUDE_CONFIG, CLAUDE_CONFIG + '.before-chatgpt-archive')
    delete cfg.mcpServers['chatgpt-archive']
    writeFileSync(CLAUDE_CONFIG, JSON.stringify(cfg, null, 2))
    log.info('removed the local Claude Desktop entry (server mode)')
  } catch (e) { log.warn('claude entry', e) }
}
function claudeDesktopState(): 'not-installed' | 'connected' | 'not-connected' | 'server' {
  if (remote) return 'server'
  if (!existsSync('/Applications/Claude.app') && !existsSync(join(HOME, 'Applications', 'Claude.app')) && !existsSync(CLAUDE_CONFIG)) return 'not-installed'
  try {
    const cfg = JSON.parse(readFileSync(CLAUDE_CONFIG, 'utf8'))
    const e = cfg?.mcpServers?.['chatgpt-archive']
    return e && e.command === UV && JSON.stringify(e.args) === JSON.stringify(mcpEntry().args) ? 'connected' : 'not-connected'
  } catch {
    return 'not-connected'
  }
}
function connectClaudeDesktop(): { ok: boolean; error?: string } {
  try {
    let cfg: any = {}
    if (existsSync(CLAUDE_CONFIG)) {
      const raw = readFileSync(CLAUDE_CONFIG, 'utf8')
      try { cfg = raw.trim() ? JSON.parse(raw) : {} } catch {
        return { ok: false, error: "Claude's settings file could not be read, so it was left unchanged." }
      }
      copyFileSync(CLAUDE_CONFIG, CLAUDE_CONFIG + '.before-chatgpt-archive')
    } else {
      mkdirSync(join(HOME, 'Library', 'Application Support', 'Claude'), { recursive: true })
    }
    cfg.mcpServers = { ...(cfg.mcpServers || {}), 'chatgpt-archive': mcpEntry() }
    writeFileSync(CLAUDE_CONFIG, JSON.stringify(cfg, null, 2))
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

// ── Web apps (a public HTTPS tunnel to the local MCP server) ─────────────────
// Web apps such as ChatGPT and claude.ai only reach public https addresses and
// their connectors cannot send an Authorization header, so the token travels in
// the path: <tunnel>/t/<token>/mcp.
// With ngrok set up (start-jarvis.sh --setup) the address never changes;
// otherwise a Cloudflare quick tunnel (no account) gets a new one on each start.
interface TunnelState { status: 'off' | 'starting' | 'on' | 'error'; url: string; stable: boolean; error: string }
let tunnel: TunnelState = { status: 'off', url: '', stable: false, error: '' }
let tunnelProc: ChildProcess | null = null
const NGROK_DOMAIN_FILE = join(ARCHIVE_DIR, '.ngrok-domain')

function findBinary(name: string): string | null {
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, 'bin', name)
    if (existsSync(bundled)) return bundled
  }
  for (const dir of EXTRA_PATHS) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return null
}

function setTunnel(t: Partial<TunnelState>) {
  tunnel = { ...tunnel, ...t }
  mainWindow?.webContents.send('web-link', webLinkPayload())
}
const versionAtLeast = (have: string, need: string) => {
  const a = have.split('.').map(Number), b = need.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  return true
}
/**
 * The macOS version the link needs when this Mac is older (else ''). The bundled
 * cloudflared may need a newer macOS than the app (prepare-bundle records it in
 * bin/cloudflared.json); ngrok, when set up, has no such limit here.
 */
function webLinkNeedsMacos(): string {
  if (!app.isPackaged) return ''
  const domain = existsSync(NGROK_DOMAIN_FILE) ? readFileSync(NGROK_DOMAIN_FILE, 'utf8').trim() : ''
  if (domain && findBinary('ngrok')) return ''
  let need = ''
  try { need = JSON.parse(readFileSync(join(process.resourcesPath, 'bin', 'cloudflared.json'), 'utf8')).minMacos || '' } catch { /* older bundle */ }
  return need && !versionAtLeast(process.getSystemVersion(), need) ? need : ''
}

function webLinkPayload() {
  if (remote) {
    // Server mode: the server is already on the internet; no tunnel needed.
    return {
      status: 'on' as const, url: remote.url, stable: true, error: '', server: true, needsMacos: '',
      macos: process.getSystemVersion(),
      connectorUrl: `${remote.url}/t/${remote.token}/mcp`, plainUrl: `${remote.url}/mcp`
    }
  }
  const token = readToken()
  const on = tunnel.status === 'on' && !!token
  return {
    server: false,
    ...tunnel,
    needsMacos: webLinkNeedsMacos(),
    macos: process.getSystemVersion(),
    // For apps that cannot send headers (ChatGPT, claude.ai): the token is in the path.
    connectorUrl: on ? `${tunnel.url}/t/${token}/mcp` : '',
    // For apps that can send `Authorization: Bearer <token>`.
    plainUrl: on ? `${tunnel.url}/mcp` : ''
  }
}

function startTunnel() {
  if (tunnelProc) return
  const need = webLinkNeedsMacos()
  if (need) {
    setTunnel({ status: 'error', error: `Connecting a web app needs macOS ${need} or newer, and this Mac has macOS ${process.getSystemVersion()}. Update it in System Settings → General → Software Update, then try again.` })
    return
  }
  const domain = existsSync(NGROK_DOMAIN_FILE) ? readFileSync(NGROK_DOMAIN_FILE, 'utf8').trim() : ''
  const ngrok = domain ? findBinary('ngrok') : null
  const cloudflared = findBinary('cloudflared')
  let cmd: string, args: string[], ready: (line: string) => string | null
  if (ngrok) {
    const url = `https://${domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`
    cmd = ngrok
    args = ['http', `--url=${url}`, `127.0.0.1:${MCP_PORT}`, '--log', 'stdout', '--log-format', 'logfmt']
    ready = (line) => (line.includes('msg="started tunnel"') ? url : null)
  } else if (cloudflared) {
    cmd = cloudflared
    args = ['tunnel', '--no-autoupdate', '--url', MCP_URL]
    let found = ''
    ready = (line) => {
      const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (m && !m[0].startsWith('https://api.')) found = m[0]
      return found && /Registered tunnel connection/.test(line) ? found : null
    }
  } else {
    setTunnel({ status: 'error', error: "The secure-link helper is missing from this copy of the app. Please reinstall it." })
    return
  }
  setTunnel({ status: 'starting', error: '', url: '', stable: !!ngrok })
  log.info(`[tunnel] starting: ${cmd} ${args.join(' ')}`)
  const proc = spawn(cmd, args, { env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
  tunnelProc = proc
  let lastLine = ''
  const giveUp = setTimeout(() => {
    if (tunnelProc === proc && tunnel.status === 'starting') {
      proc.kill()
      setTunnel({ status: 'error', error: 'The secure link could not be opened. Please check the internet connection, then try again.' })
    }
  }, 60000)
  const onData = (d: Buffer) => {
    for (const line of d.toString().split(/\r?\n/).filter(Boolean)) {
      lastLine = line
      const url = tunnel.status === 'starting' ? ready(line) : null
      if (url) { clearTimeout(giveUp); log.info('[tunnel] ready', url); setTunnel({ status: 'on', url }) }
    }
  }
  proc.stdout?.on('data', onData)
  proc.stderr?.on('data', onData)
  proc.on('error', (err) => { clearTimeout(giveUp); setTunnel({ status: 'error', error: `The secure link could not be started (${err.message}).` }) })
  proc.on('exit', (code) => {
    clearTimeout(giveUp)
    if (tunnelProc !== proc) return
    tunnelProc = null
    log.warn('[tunnel] exited', code, lastLine)
    if (isQuitting || tunnel.status === 'off') return
    setTunnel({ status: 'error', url: '', error: 'The secure link stopped (for example after the internet dropped). Click "Try again".' })
  })
}

function stopTunnel() {
  const proc = tunnelProc
  tunnelProc = null
  setTunnel({ status: 'off', url: '', error: '' })
  proc?.kill()
}

// ── IPC ───────────────────────────────────────────────────────────────────────
/**
 * The renderer talks to the Ingest API through here: the main process adds the
 * Bearer token and is not subject to the browser's CORS rules.
 */
async function apiRequest(method: string, path: string, body?: unknown) {
  if (!['GET', 'POST', 'DELETE'].includes(method) || typeof path !== 'string' || !path.startsWith('/')) {
    return { ok: false, status: 0, error: 'bad request' }
  }
  try {
    const r = await fetch(apiBase() + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiToken()}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000)
    })
    const data = await r.json().catch(() => null)
    return r.ok
      ? { ok: true, status: r.status, data }
      : { ok: false, status: r.status, error: (data && (data.detail || data.error)) || r.statusText }
  } catch {
    return {
      ok: false, status: 0,
      error: remote ? `Can't reach your archive server (${remote.url}).`
        : phase === 'starting' ? 'The archive is still starting up…' : 'The archive is not running.'
    }
  }
}
ipcMain.handle('api', (_e, method: string, path: string, body?: unknown) => apiRequest(method, path, body))
registerAi(apiRequest)

ipcMain.handle('get-status', () => statusPayload())
ipcMain.handle('retry-start', () => retryStart())
ipcMain.handle('open-in-chatgpt', (_e, id: string) => {
  if (/^[0-9a-f-]{20,}$/i.test(id)) shell.openExternal(`https://chatgpt.com/c/${id}`)
})
ipcMain.handle('open-url', (_e, url: string) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url)
})
ipcMain.handle('extension-info', () => ({ folder: EXTENSION_DIR, installed: existsSync(EXTENSION_DIR) }))
ipcMain.handle('extension-prepare', () => {
  const dir = installExtensionFiles()
  shell.showItemInFolder(dir)
  return dir
})
ipcMain.handle('extension-reveal', () => {
  if (!existsSync(EXTENSION_DIR)) installExtensionFiles()
  shell.showItemInFolder(EXTENSION_DIR)
})
ipcMain.handle('open-chrome-extensions', () => openChromeExtensionsPage())
ipcMain.handle('claude-desktop-state', () => claudeDesktopState())
ipcMain.handle('claude-desktop-connect', () => connectClaudeDesktop())
ipcMain.handle('get-login-item', () => ({ enabled: loginItemEnabled(), available: app.isPackaged }))
ipcMain.handle('set-login-item', (_e, on: boolean) => { setLoginItem(!!on); return loginItemEnabled() })
ipcMain.handle('get-advanced', () => {
  const token = apiToken()
  const mcpUrl = remote ? `${remote.url}/mcp` : `${MCP_URL}/mcp`
  return {
    token, dataFolder: ARCHIVE_DIR, db: DB_PATH, server: remote?.url || '',
    claudeCode: `claude mcp add --transport http chatgpt-archive ${mcpUrl} --header "Authorization: Bearer ${token}"`,
    mcpConfig: JSON.stringify({ mcpServers: { 'chatgpt-archive': remote
      ? { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${token}` } }
      : mcpEntry() } }, null, 2),
    version: app.getVersion()
  }
})
ipcMain.handle('open-data-folder', () => shell.openPath(ARCHIVE_DIR))
ipcMain.handle('open-logs', () => shell.openPath(app.getPath('logs')))
ipcMain.on('rebuild-index', () => { if (!remote) rebuildIndex() })
ipcMain.handle('web-link-state', () => webLinkPayload())
ipcMain.handle('web-link-connect', () => {
  if (remote) return webLinkPayload()
  writePrefs({ ...readPrefs(), webLink: true })
  if (tunnel.status === 'error') stopTunnel()
  startTunnel()
  return webLinkPayload()
})
ipcMain.handle('web-link-disconnect', () => {
  if (remote) return webLinkPayload()
  writePrefs({ ...readPrefs(), webLink: false })
  stopTunnel()
  return webLinkPayload()
})

// ── Storage: moving to a server, switching back, freeing space ─────────────
const MIGRATE_SCRIPT = join(KB_DIR, 'migrate.py')
const MODELS_DIR = process.env.CHATGPT_ARCHIVE_MODELS || join(HOME, 'Library', 'Application Support', 'ChatGPTArchive', 'models')
let migrateProc: ChildProcess | null = null

function diskKB(path: string): Promise<number> {
  return new Promise((resolve) => {
    if (!existsSync(path)) return resolve(0)
    execFile('/usr/bin/du', ['-sk', path], (err, out) => resolve(err ? 0 : parseInt(out, 10) || 0))
  })
}
async function localUsage() {
  const db = (await Promise.all(['', '-wal', '-shm'].map(x => diskKB(DB_PATH + x)))).reduce((a, b) => a + b, 0)
  const [exports, models] = await Promise.all([diskKB(EXPORTS_DIR), diskKB(MODELS_DIR)])
  return { hasLocalCopy: existsSync(DB_PATH), dataMB: Math.round((db + exports) / 102.4) / 10, modelMB: Math.round(models / 102.4) / 10 }
}

/** Checks address + access code before anything is sent. */
async function testServer(input: string, token: string): Promise<{ ok: true; url: string; chats: number } | { ok: false; error: string }> {
  const url = normalizeServerUrl(input || '')
  if (!url) return { ok: false, error: 'Please type the server address, for example https://archive.example.com' }
  if (url === API_URL) return { ok: false, error: "That is this Mac's own archive, not a server." }
  if (!token.trim()) return { ok: false, error: 'Please paste the access code.' }
  let h: Response
  try { h = await fetch(`${url}/health`, { signal: AbortSignal.timeout(15000) }) } catch {
    return { ok: false, error: `Can't reach ${url}. Check the address and the internet connection.` }
  }
  const hj: any = await h.json().catch(() => null)
  if (!h.ok || hj?.status !== 'ok' || !('conversations' in hj)) return { ok: false, error: `There is no ChatGPT Archive server at ${url}.` }
  const st = await fetch(`${url}/stats`, { headers: { Authorization: `Bearer ${token.trim()}` }, signal: AbortSignal.timeout(15000) }).catch(() => null)
  if (!st) return { ok: false, error: `Can't reach ${url}. Check the internet connection.` }
  if (st.status === 401 || st.status === 403) return { ok: false, error: 'The server did not accept the access code.' }
  if (!st.ok) return { ok: false, error: `The server answered with an error (${st.status}).` }
  const sj: any = await st.json().catch(() => ({}))
  return { ok: true, url, chats: sj.conversations ?? 0 }
}

/** Runs kb/migrate.py: copies every local chat to the server and verifies them all. */
function runMigrate(url: string, token: string, onProgress: (done: number, total: number) => void): Promise<{ ok: true; result: any } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    if (migrateProc) return resolve({ ok: false, error: 'A move is already running.' })
    // The access code goes in the environment, not the command line (other programs can read that).
    const proc = spawn(UV, ['run', '--quiet', '--script', MIGRATE_SCRIPT, '--to', url, '--db', DB_PATH],
      { env: { ...CHILD_ENV, ARCHIVE_SERVER_TOKEN: token } })
    migrateProc = proc
    let result: any = null, error = '', buf = ''
    const onData = (d: Buffer) => {
      buf += d.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
        log.info('[migrate]', line)
        let m: RegExpMatchArray | null
        if ((m = line.match(/^@progress (\d+) (\d+)$/))) onProgress(+m[1], +m[2])
        else if (line.startsWith('@error ')) error = line.slice(7)
        else if (line.startsWith('@done ')) { try { result = JSON.parse(line.slice(6)) } catch { /* ignore */ } }
      }
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.on('error', (e) => { migrateProc = null; resolve({ ok: false, error: `The move could not start (${e.message}).` }) })
    proc.on('exit', () => {
      migrateProc = null
      resolve(result ? { ok: true, result } : { ok: false, error: error || 'The move did not finish. Nothing on this Mac was changed; please try again.' })
    })
  })
}

/** From now on use the server for everything; nothing runs locally any more. */
function switchToServer(r: Remote) {
  stopTunnel()
  writePrefs({ ...readPrefs(), webLink: false })
  stopServers()
  writeRemote(r)
  remote = r
  if (existsSync(EXTENSION_DIR)) installExtensionFiles()
  removeClaudeDesktopEntry()
  startServers()
  mainWindow?.webContents.send('web-link', webLinkPayload())
  log.info('storage: now using the server', r.url)
}

ipcMain.handle('storage-info', async () => ({ mode: remote ? 'server' : 'local', server: remote?.url || '', ...(await localUsage()) }))
ipcMain.handle('server-test', (_e, url: string, token: string) => testServer(url, token))
ipcMain.handle('server-move', async (e, url: string, token: string) => {
  if (remote) return { ok: false, error: 'Already using a server.' }
  const t = await testServer(url, token)
  if (!t.ok) return t
  const send = (ev: object) => { if (!e.sender.isDestroyed()) e.sender.send('move-event', ev) }
  runMigrate(t.url, token.trim(), (done, total) => send({ type: 'progress', done, total })).then((r) => {
    if (!r.ok) return send({ type: 'error', error: r.error })
    // Report first: switching briefly replaces the window with "Connecting…".
    send({ type: 'done', result: r.result, extensionInstalled: existsSync(EXTENSION_DIR) })
    setTimeout(() => switchToServer({ url: t.url, token: token.trim() }), 400)
  })
  return { ok: true }
})
// For a second Mac (or a reinstall): use a server that already has the chats, without moving anything.
ipcMain.handle('server-connect', async (_e, url: string, token: string) => {
  const t = await testServer(url, token)
  if (!t.ok) return t
  setTimeout(() => switchToServer({ url: t.url, token: token.trim() }), 400)
  return { ok: true, chats: t.chats, extensionInstalled: existsSync(EXTENSION_DIR) }
})
ipcMain.handle('server-disconnect', async () => {
  const usage = await localUsage()
  setTimeout(() => {
    writeRemote(null)
    remote = null
    if (existsSync(EXTENSION_DIR)) installExtensionFiles()
    startServers()
    mainWindow?.webContents.send('web-link', webLinkPayload())
    log.info('storage: back to this Mac')
  }, 400)
  return { ok: true, extensionInstalled: existsSync(EXTENSION_DIR), ...usage }
})
ipcMain.handle('free-local-space', async (e) => {
  if (!remote) return { ok: false, error: 'Your chats are only on this Mac, so they cannot be removed here.' }
  const before = await localUsage()
  if (!before.hasLocalCopy && before.modelMB === 0) return { ok: true, freedMB: 0 }
  // Check again, right now, that the server has every chat (and send any it is missing).
  if (before.hasLocalCopy) {
    const send = (ev: object) => { if (!e.sender.isDestroyed()) e.sender.send('move-event', ev) }
    const r = await runMigrate(remote.url, remote.token, (done, total) => send({ type: 'progress', done, total }))
    if (!r.ok) return { ok: false, error: `Nothing was deleted: ${r.error}` }
  }
  // (The window asked the person to confirm before calling this.)
  const total = Math.round((before.dataMB + before.modelMB) * 10) / 10
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`, DB_PATH.replace(/\.db$/, '.db.tmp'), join(ARCHIVE_DIR, 'data', 'extension-last-seen')]) {
    rmSync(f, { force: true })
  }
  rmSync(EXPORTS_DIR, { recursive: true, force: true })
  rmSync(MODELS_DIR, { recursive: true, force: true })
  log.info(`storage: removed the local copy (${total} MB)`)
  return { ok: true, freedMB: total }
})

// ── App lifecycle ─────────────────────────────────────────────────────────────
// One copy only: a second copy would fight over ports 47821/47822.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.on('activate', showWindow)

  app.whenReady().then(async () => {
    // Running from the downloaded disk image: offer to move into Applications,
    // so the app (and the paths saved in Chrome/Claude) keep working.
    if (app.isPackaged && !app.isInApplicationsFolder() && !process.env.CHATGPT_ARCHIVE_OFFSCREEN) {
      const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Move to Applications', 'Not now'],
        defaultId: 0,
        message: 'Move ChatGPT Archive to your Applications folder?',
        detail: 'It needs to live in Applications to keep working after you eject the installer.'
      })
      if (response === 0) {
        try { if (app.moveToApplicationsFolder()) return } catch (e) { log.warn('move', e) }
      }
    }

    const prefs = readPrefs()
    if (!prefs.initialized) {
      setLoginItem(true) // the extension can only save chats while the app runs
      writePrefs({ ...prefs, initialized: true })
    }
    createTray()
    refreshExtensionIfOutdated()
    // The tunnel starts after leftovers from an earlier run were cleaned up.
    startServers(true).then(() => { if (!remote && readPrefs().webLink) startTunnel() })
    if (!process.argv.includes('--hidden')) showWindow()
    else app.dock?.hide()
  })

  app.on('before-quit', () => { isQuitting = true; stopServers(); tunnelProc?.kill(); migrateProc?.kill() })
  app.on('window-all-closed', () => { /* stay alive — menu bar app */ })
}
