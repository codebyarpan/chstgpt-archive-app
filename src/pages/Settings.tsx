import { useState, useEffect, ReactNode, useRef } from 'react'
import { Copy, Check, ChevronDown, ChevronRight, Chrome, Power, Bot, Wrench, HelpCircle, Link2, Sparkles } from 'lucide-react'
import { api, Stats } from '../api'
import { Button, Card, PageTitle, useApp } from '../ui'
import ConnectChrome from '../ConnectChrome'
import ConnectChatGPT from '../ConnectChatGPT'
import AiSettings from '../AiSettings'

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: ReactNode }) {
  return (
    <Card className="p-6 mb-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-50 mb-4"><Icon size={18} className="text-emerald-400" /> {title}</h2>
      {children}
    </Card>
  )
}

function CopyBox({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-slate-400">{label}</p>
        <button
          onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white"
        >
          {copied ? <><Check size={13} className="text-emerald-400" /> Copied</> : <><Copy size={13} /> Copy</>}
        </button>
      </div>
      <pre className="text-xs text-slate-300 font-mono bg-slate-950 border border-slate-800 rounded-lg p-3 whitespace-pre-wrap break-all select-text">{text}</pre>
    </div>
  )
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-slate-800 last:border-0">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 py-3 text-left text-sm text-slate-200 hover:text-white">
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {q}
      </button>
      {open && <div className="pl-6 pb-4 text-sm text-slate-400 leading-relaxed">{children}</div>}
    </div>
  )
}

export default function Settings() {
  const { toast, changed } = useApp()
  const [stats, setStats] = useState<Stats | null>(null)
  const [login, setLogin] = useState<{ enabled: boolean; available: boolean } | null>(null)
  const [claude, setClaude] = useState<'not-installed' | 'connected' | 'not-connected' | null>(null)
  const [adv, setAdv] = useState<AdvancedInfo | null>(null)
  const [showAdv, setShowAdv] = useState(false)
  const [rebuildLog, setRebuildLog] = useState('')
  const [rebuilding, setRebuilding] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const loadStats = () => api.stats().then(setStats).catch(() => {})
    loadStats()
    const t = setInterval(loadStats, 5000)
    window.api!.getLoginItem().then(setLogin)
    window.api!.claudeDesktopState().then(setClaude)
    window.api!.getAdvanced().then(setAdv)
    const off1 = window.api!.onRebuildProgress(line => {
      setRebuildLog(prev => prev + line)
      setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 30)
    })
    const off2 = window.api!.onRebuildDone(code => {
      setRebuilding(false)
      toast(code === 0 ? 'Repair finished' : 'Repair did not finish, see the details below', code === 0 ? 'ok' : 'error')
      changed()
    })
    return () => { clearInterval(t); off1(); off2() }
  }, [toast, changed])

  // Arriving from "Go to Settings" elsewhere: scroll to the section asked for.
  useEffect(() => {
    const anchor = sessionStorage.getItem('settingsAnchor')
    if (!anchor) return
    sessionStorage.removeItem('settingsAnchor')
    setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }, [])

  const connectClaude = async () => {
    const r = await window.api!.claudeDesktopConnect()
    if (r.ok) { setClaude('connected'); toast('Done. Quit and reopen Claude to use it.') }
    else toast(r.error || 'Could not connect Claude', 'error')
  }

  return (
    <div>
      <PageTitle title="Settings & help" />

      <Section icon={Chrome} title="Chrome extension">
        <ConnectChrome connected={!!stats?.extension_last_seen} />
        {stats?.extension_last_seen && (
          <p className="text-xs text-slate-500 mt-3">
            Need to set it up again (for example after reinstalling Chrome)?{' '}
            <button className="underline hover:text-slate-300" onClick={() => window.api!.extensionReveal()}>Show the extension folder</button>
          </p>
        )}
      </Section>

      <div id="ai" className="scroll-mt-10">
        <Section icon={Sparkles} title="AI chatbot (optional)">
          <AiSettings />
        </Section>
      </div>

      <Section icon={Power} title="Keep it running">
        <label className={`flex items-start gap-3 ${login?.available ? 'cursor-pointer' : 'opacity-60'}`}>
          <input
            type="checkbox" className="mt-1 w-4 h-4 accent-emerald-600"
            checked={!!login?.enabled} disabled={!login?.available}
            onChange={async e => setLogin({ enabled: await window.api!.setLoginItem(e.target.checked), available: true })}
          />
          <span>
            <span className="text-sm text-slate-100">Start ChatGPT Archive automatically when I log in</span>
            <span className="block text-sm text-slate-400 mt-0.5">
              Chrome can only save chats while this app is running. It runs quietly in the menu bar (top-right of your screen);
              closing this window does not stop it.
            </span>
          </span>
        </label>
      </Section>

      <Section icon={Bot} title="Use your archive in Claude (optional)">
        <p className="text-sm text-slate-400 mb-4">
          Lets the Claude app search and read your saved ChatGPT chats when you ask it about them,
          e.g. “what did I discuss with ChatGPT about my resume?”.
        </p>
        {claude === 'connected' ? (
          <p className="text-sm text-emerald-300 flex items-center gap-2"><Check size={16} /> Claude is connected. If you just connected it, quit and reopen Claude.</p>
        ) : claude === 'not-installed' ? (
          <p className="text-sm text-slate-400">
            The Claude app is not installed on this Mac. If you install it later, come back here and click Connect.{' '}
            <button className="text-emerald-400 underline" onClick={() => window.api!.openUrl('https://claude.ai/download')}>Get Claude</button>
          </p>
        ) : (
          <Button onClick={connectClaude}>Connect Claude</Button>
        )}
      </Section>

      <Section icon={Link2} title="Use your archive in ChatGPT (optional)">
        <ConnectChatGPT />
      </Section>

      <Section icon={HelpCircle} title="Questions">
        <Faq q="Where are my chats stored? Are they uploaded anywhere?">
          Everything stays on this Mac. The app does not upload your chats anywhere. Smart search also runs on this Mac.
        </Faq>
        <Faq q="I don't see the green archive button on chatgpt.com">
          Make sure the extension is added (steps above), then reload the chatgpt.com page. The button is a small green circle in the bottom-right corner.
        </Faq>
        <Faq q='Chrome says "Archive app is not running"'>
          Open ChatGPT Archive from your Applications folder. It keeps running in the menu bar after you close its window.
        </Faq>
        <Faq q="I changed a chat in ChatGPT. How do I update the saved copy?">
          Save it again from the green button. The newer version replaces the old one; groups are kept.
        </Faq>
        <Faq q='Chrome shows "Disable developer mode extensions"'>
          Click the X to close that message (do not click Disable). It is a standard reminder for extensions added from a folder.
        </Faq>
        <Faq q="How do I quit the app completely?">
          Click its icon in the menu bar at the top-right of the screen and choose “Quit ChatGPT Archive”.
        </Faq>
      </Section>

      <Card className="mb-5">
        <button onClick={() => setShowAdv(s => !s)} className="w-full flex items-center gap-2 px-6 py-4 text-sm text-slate-300 hover:text-white">
          {showAdv ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Wrench size={16} /> Advanced (for technical help)
        </button>
        {showAdv && adv && (
          <div className="px-6 pb-6">
            <div className="flex flex-wrap gap-2 mb-5">
              <Button variant="secondary" onClick={() => window.api!.openDataFolder()}>Open data folder</Button>
              <Button variant="secondary" onClick={() => window.api!.openLogs()}>Show log files</Button>
              <Button variant="secondary" busy={rebuilding} onClick={() => { setRebuilding(true); setRebuildLog(''); window.api!.rebuildIndex() }}
                title="Re-reads the saved copy of every chat and rebuilds the search database. Groups are kept.">
                Repair database
              </Button>
            </div>
            {rebuildLog && (
              <pre ref={logRef} className="mb-5 text-xs text-emerald-300 font-mono bg-slate-950 border border-slate-800 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap select-text">{rebuildLog}</pre>
            )}
            {stats && (
              <p className="text-xs text-slate-500 mb-4">
                {stats.conversations} chats · {stats.messages} messages · smart search covers {stats.embedded_chunks} of {stats.chunks} passages · database {stats.db_size_mb} MB
                {stats.embedding.last_error ? ` · last smart-search error: ${stats.embedding.last_error}` : ''}
              </p>
            )}
            <CopyBox label="Access token (the Chrome extension fills this in by itself)" text={adv.token} />
            <CopyBox label="Claude Code — add as an MCP server over HTTP (needs this app running)" text={adv.claudeCode} />
            <CopyBox label="MCP config for other clients (stdio)" text={adv.mcpConfig} />
            <p className="text-xs text-slate-500">Data folder: <span className="font-mono select-text">{adv.dataFolder}</span> · App version {adv.version}</p>
          </div>
        )}
      </Card>
    </div>
  )
}
