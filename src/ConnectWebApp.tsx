import { useEffect, useState, ReactNode } from 'react'
import { AlertTriangle, Check, Copy, Globe, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from './ui'

type Tab = 'chatgpt' | 'claude' | 'other'
const TABS: { id: Tab; label: string }[] = [
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'claude', label: 'Claude on the web' },
  { id: 'other', label: 'Other apps' }
]

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-200 flex items-center justify-center shrink-0">{n}</span>
      <div className="text-sm text-slate-400 leading-relaxed pt-0.5 min-w-0 flex-1">{children}</div>
    </li>
  )
}

function CopyLine({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 flex items-center gap-2">
      <code className="flex-1 min-w-0 truncate text-xs font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 select-text">{text}</code>
      <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>
        {copied ? <><Check size={15} className="text-emerald-400" /> Copied</> : <><Copy size={15} /> {label}</>}
      </Button>
    </div>
  )
}

const b = (t: string) => <b className="text-slate-200">{t}</b>
const link = (url: string, label: string) => (
  <button className="text-emerald-400 underline" onClick={() => window.api!.openUrl(url)}>{label}</button>
)

/**
 * "Connect a web app": opens a secure public link to this Mac's archive, so web
 * apps (ChatGPT, Claude on the web, …) can search it, and shows how to add it to each.
 */
export default function ConnectWebApp() {
  const [s, setS] = useState<WebLinkState | null>(null)
  const [tab, setTab] = useState<Tab>('chatgpt')
  const [token, setToken] = useState('')

  useEffect(() => {
    window.api!.webLinkState().then(setS)
    window.api!.getAdvanced().then(a => setToken(a.token))
    return window.api!.onWebLink(setS)
  }, [])

  if (!s) return null

  if (s.status === 'off') {
    return (
      <div>
        <p className="text-sm text-slate-400 mb-4">
          Lets AI apps that run in a web browser, such as ChatGPT and Claude on the web, search and read your saved chats.
          This app opens a private, secure link to your archive that only you know. It works while this app is running.
        </p>
        <Button onClick={() => window.api!.webLinkConnect().then(setS)}><Globe size={15} /> Connect a web app</Button>
      </div>
    )
  }

  if (s.status === 'starting') {
    return (
      <p className="text-sm text-slate-300 flex items-center gap-2">
        <Loader2 size={16} className="animate-spin text-emerald-400" /> Opening a secure link… (this takes a few seconds)
      </p>
    )
  }

  if (s.status === 'error') {
    return (
      <div>
        <p className="text-sm text-amber-300 flex items-start gap-2 mb-4"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> {s.error}</p>
        <div className="flex gap-2">
          <Button onClick={() => window.api!.webLinkConnect().then(setS)}>Try again</Button>
          <Button variant="ghost" onClick={() => window.api!.webLinkDisconnect().then(setS)}>Turn off</Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-emerald-300 flex items-center gap-2 mb-4"><Check size={16} /> The secure link is open. Pick the app you want to connect:</p>

      <div role="tablist" className="inline-flex p-1 mb-5 rounded-xl bg-slate-950 border border-slate-800">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${tab === t.id ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'chatgpt' && (
        <ol className="space-y-3 mb-5">
          <Step n={1}>Copy your link:<CopyLine text={s.connectorUrl} /></Step>
          <Step n={2}>
            On {link('https://chatgpt.com/#settings/Connectors', 'chatgpt.com')}, open {b('Settings → Apps & Connectors')} (the name can differ slightly).
            Under {b('Advanced settings')}, turn on {b('Developer mode')}. Needs a paid ChatGPT plan.
          </Step>
          <Step n={3}>
            Click {b('Create')} (or {b('Add custom connector')}). Name: {b('ChatGPT Archive')}. Paste the link as the {b('MCP server URL')}.
            For {b('Authentication')} choose {b('No authentication')}. The link already contains your private access code. Tick {b('I trust this application')}, then {b('Create')}.
          </Step>
          <Step n={4}>In a new ChatGPT chat, click {b('+')}, pick {b('ChatGPT Archive')} (under Developer mode or More) and ask, e.g. “search my archive for my resume notes”.</Step>
        </ol>
      )}

      {tab === 'claude' && (
        <ol className="space-y-3 mb-5">
          <Step n={1}>Copy your link:<CopyLine text={s.connectorUrl} /></Step>
          <Step n={2}>
            On {link('https://claude.ai/settings/connectors', 'claude.ai')}, open {b('Settings → Connectors')} and click {b('Add custom connector')} (the names can differ slightly).
          </Step>
          <Step n={3}>
            Name: {b('ChatGPT Archive')}. Paste the link as the {b('Remote MCP server URL')}. Leave the advanced (OAuth) settings empty: the link already contains your private access code. Click {b('Add')}.
          </Step>
          <Step n={4}>
            In a new chat, turn on {b('ChatGPT Archive')} in the tools menu (the sliders or {b('+')} button) and ask, e.g. “what did I discuss with ChatGPT about my resume?”.
            Claude asks before it uses the archive the first time.
          </Step>
        </ol>
      )}

      {tab === 'other' && (
        <ol className="space-y-3 mb-5">
          <Step n={1}>
            In the app's settings, look for {b('MCP server')}, {b('connector')} or {b('tools')}. Choose the kind that takes a web address
            ({b('remote')}, {b('HTTP')} or {b('Streamable HTTP')}).
          </Step>
          <Step n={2}>
            If it only asks for an address, use this link (your access code is inside it):
            <CopyLine text={s.connectorUrl} />
          </Step>
          <Step n={3}>
            If it also lets you add a {b('header')}, you can use the plain address instead and send the access code as a header:
            <CopyLine text={s.plainUrl} label="Copy address" />
            {token && <CopyLine text={`Authorization: Bearer ${token}`} label="Copy header" />}
          </Step>
          <Step n={4}>Apps on this Mac (Claude Code, Cursor, VS Code…) don't need this link: use Advanced below instead.</Step>
        </ol>
      )}

      {!s.stable && (
        <p className="text-xs text-amber-300/90 mb-2 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          This link changes each time the app restarts. If a web app stops finding your archive, come back here, copy the new link, and update it in that app's connector settings.
        </p>
      )}
      <p className="text-xs text-slate-500 mb-4 flex items-start gap-2">
        <ShieldAlert size={14} className="shrink-0 mt-0.5" />
        Anyone who has this link can read your saved chats. Only paste it into apps you trust, and don't share it. To close it, click Turn off.
      </p>
      <Button variant="secondary" onClick={() => window.api!.webLinkDisconnect().then(setS)}>Turn off</Button>
    </div>
  )
}
