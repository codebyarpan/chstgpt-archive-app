import { useEffect, useState, ReactNode } from 'react'
import { AlertTriangle, Check, Copy, Link2, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from './ui'

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-200 flex items-center justify-center shrink-0">{n}</span>
      <div className="text-sm text-slate-400 leading-relaxed pt-0.5">{children}</div>
    </li>
  )
}

/**
 * "Connect ChatGPT": opens a secure public link to this Mac's archive and shows
 * how to add it to ChatGPT as a connector (ChatGPT cannot reach the Mac otherwise).
 */
export default function ConnectChatGPT() {
  const [s, setS] = useState<ChatgptState | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.api!.chatgptState().then(setS)
    return window.api!.onChatgpt(setS)
  }, [])

  if (!s) return null

  const copy = () => {
    navigator.clipboard.writeText(s.connectorUrl)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }
  const b = (t: string) => <b className="text-slate-200">{t}</b>

  if (s.status === 'off') {
    return (
      <div>
        <p className="text-sm text-slate-400 mb-4">
          Lets ChatGPT search and read your saved chats. This app opens a private, secure link to your archive that only you know.
          Needs a paid ChatGPT plan (Plus or higher), and works while this app is running.
        </p>
        <Button onClick={() => window.api!.chatgptConnect().then(setS)}><Link2 size={15} /> Connect ChatGPT</Button>
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
          <Button onClick={() => window.api!.chatgptConnect().then(setS)}>Try again</Button>
          <Button variant="ghost" onClick={() => window.api!.chatgptDisconnect().then(setS)}>Turn off</Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-emerald-300 flex items-center gap-2 mb-4"><Check size={16} /> The secure link is open. Now add it to ChatGPT:</p>
      <ol className="space-y-3 mb-5">
        <Step n={1}>
          Copy your link:
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-xs font-mono text-slate-300 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 select-text">{s.connectorUrl}</code>
            <Button variant="secondary" onClick={copy}>{copied ? <><Check size={15} className="text-emerald-400" /> Copied</> : <><Copy size={15} /> Copy</>}</Button>
          </div>
        </Step>
        <Step n={2}>
          On <button className="text-emerald-400 underline" onClick={() => window.api!.openUrl('https://chatgpt.com/#settings/Connectors')}>chatgpt.com</button>,
          open {b('Settings → Apps & Connectors')} (the name can differ slightly). Under {b('Advanced settings')}, turn on {b('Developer mode')}.
        </Step>
        <Step n={3}>
          Click {b('Create')} (or {b('Add custom connector')}). Name: {b('ChatGPT Archive')}. Paste the link as the {b('MCP server URL')}.
          For {b('Authentication')} choose {b('No authentication')}. The link already contains your private access code. Tick {b('I trust this application')}, then {b('Create')}.
        </Step>
        <Step n={4}>
          In a new ChatGPT chat, click {b('+')}, pick {b('ChatGPT Archive')} (under Developer mode or More) and ask, e.g. “search my archive for my resume notes”.
        </Step>
      </ol>
      {!s.stable && (
        <p className="text-xs text-amber-300/90 mb-2 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          This link changes each time the app restarts. If ChatGPT stops finding your archive, come back here, copy the new link, and update it in ChatGPT's connector settings.
        </p>
      )}
      <p className="text-xs text-slate-500 mb-4 flex items-start gap-2">
        <ShieldAlert size={14} className="shrink-0 mt-0.5" />
        Anyone who has this link can read your saved chats. Don't share it. To revoke it, click Turn off.
      </p>
      <Button variant="secondary" onClick={() => window.api!.chatgptDisconnect().then(setS)}>Turn off</Button>
    </div>
  )
}
