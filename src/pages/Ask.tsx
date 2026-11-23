import { useEffect, useRef, useState, KeyboardEvent } from 'react'
import { Bot, Send, Square, Sparkles, RotateCcw, Settings as SettingsIcon, AlertCircle, MessageSquareText } from 'lucide-react'
import { niceDate } from '../api'
import { Button, Markdown, PageTitle, useApp } from '../ui'

interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: AskSource[]
  pending?: boolean
  error?: string
}

const EXAMPLES = [
  'What did I decide about my project name?',
  'Summarise what I learned about investing',
  'Which recipes did I ask ChatGPT for?'
]

/** The sources an answer actually cites ([1], [2]…), or all of them if it cites none. */
function cited(m: Msg): AskSource[] {
  const all = m.sources || []
  const used = new Set([...m.content.matchAll(/\[(\d+)\]/g)].map(x => Number(x[1])))
  const picked = all.filter(s => used.has(s.n))
  return picked.length ? picked : m.pending ? [] : all
}

/** Popup shown when no AI service is connected yet. */
function ConnectPopup({ onClose }: { onClose: () => void }) {
  const { go } = useApp()
  const toSettings = () => { sessionStorage.setItem('settingsAnchor', 'ai'); go('settings') }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
        className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 text-center">
        <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-emerald-600/15 border border-emerald-700/40 flex items-center justify-center">
          <Bot size={28} className="text-emerald-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-50 mb-2">Connect an AI service first</h2>
        <p className="text-sm text-slate-400 leading-relaxed mb-6">
          The chatbot answers questions about your saved chats using an AI service. Add a key in Settings.
          It takes about a minute: <b className="text-slate-200">Groq</b> has a free plan, or use an <b className="text-slate-200">xAI Grok</b> key.
        </p>
        <div className="flex justify-center gap-3">
          <Button onClick={toSettings} autoFocus><SettingsIcon size={15} /> Go to Settings</Button>
          <Button variant="ghost" onClick={onClose}>Not now</Button>
        </div>
      </div>
    </div>
  )
}

export default function Ask() {
  const { go, openChat } = useApp()
  const [cfg, setCfg] = useState<AiConfig | null>(null)
  const [popup, setPopup] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const live = useRef<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api!.aiGet().then(c => { setCfg(c); if (!c.hasKey) setPopup(true) })
  }, [])

  useEffect(() => window.api!.onAskEvent(ev => {
    setMsgs(ms => ms.map(m => {
      if (m.id !== ev.id) return m
      if (ev.type === 'sources') return { ...m, sources: ev.sources }
      if (ev.type === 'delta') return { ...m, content: m.content + ev.text }
      if (ev.type === 'error') return { ...m, pending: false, error: ev.error }
      return { ...m, pending: false }
    }))
    if (ev.type === 'done' || ev.type === 'error') live.current = null
  }), [])

  // Stop a running answer when leaving the page.
  useEffect(() => () => { if (live.current) window.api!.askCancel(live.current) }, [])
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [msgs])

  const busy = msgs.some(m => m.pending)
  const ready = !!cfg?.hasKey

  const send = (text = input) => {
    const q = text.trim()
    if (!q || busy) return
    if (!ready) { setPopup(true); return }
    const id = `a${Date.now()}`
    const history = [...msgs.filter(m => !m.error && m.content), { role: 'user' as const, content: q }]
      .map(m => ({ role: m.role, content: m.content }))
    setMsgs(ms => [...ms, { id: `u${id}`, role: 'user', content: q }, { id, role: 'assistant', content: '', pending: true }])
    setInput('')
    live.current = id
    window.api!.askStart(id, history)
  }
  const stop = () => { if (live.current) window.api!.askCancel(live.current) }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }
  const provider = cfg?.providers.find(p => p.id === cfg.provider)?.name

  return (
    <div className="flex flex-col min-h-[calc(100vh-5rem)]">
      {popup && <ConnectPopup onClose={() => setPopup(false)} />}
      <PageTitle
        title="Ask AI"
        subtitle={ready ? `Ask anything about your saved chats. Answers come from your archive (using ${provider}).` : 'Ask questions about your saved chats in plain language.'}
        right={msgs.length > 0 ? <Button variant="ghost" onClick={() => { stop(); setMsgs([]) }}><RotateCcw size={15} /> New conversation</Button> : undefined}
      />

      <div className="flex-1 space-y-6 pb-6">
        {msgs.length === 0 && (
          <div className="text-center py-10">
            <MessageSquareText size={40} className="mx-auto mb-4 text-slate-600" />
            {ready ? (
              <>
                <p className="text-base text-slate-200 mb-4">What would you like to know?</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {EXAMPLES.map(x => (
                    <button key={x} onClick={() => send(x)} className="text-sm px-3 py-2 rounded-xl border border-slate-700 text-slate-300 hover:border-emerald-600 hover:text-white">{x}</button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="text-base text-slate-200 mb-2">No AI service is connected yet</p>
                <p className="text-sm text-slate-400 mb-5">Add a free Groq key or an xAI Grok key in Settings to start chatting.</p>
                <Button onClick={() => { sessionStorage.setItem('settingsAnchor', 'ai'); go('settings') }}><SettingsIcon size={15} /> Go to Settings</Button>
              </>
            )}
          </div>
        )}

        {msgs.map(m => m.role === 'user' ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-sky-950/50 border border-sky-900/50 text-sm text-slate-100 whitespace-pre-wrap select-text">{m.content}</div>
          </div>
        ) : (
          <div key={m.id} className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-emerald-600/25 text-emerald-300 flex items-center justify-center shrink-0"><Sparkles size={14} /></div>
            <div className="flex-1 min-w-0">
              {m.content && <div className="select-text"><Markdown text={m.content} /></div>}
              {m.pending && !m.content && (
                <p className="text-sm text-slate-400 animate-pulse">{m.sources ? 'Writing the answer…' : 'Looking through your saved chats…'}</p>
              )}
              {m.error && (
                <p className="mt-1 text-sm text-amber-300 flex items-start gap-2">
                  <AlertCircle size={15} className="shrink-0 mt-0.5" /> <span>{m.error}</span>
                </p>
              )}
              {cited(m).length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-slate-500 mb-1.5">From your chats:</p>
                  <div className="flex flex-wrap gap-2">
                    {cited(m).map(s => (
                      <button key={s.n} onClick={() => openChat(s.conversation_id, { at: s.message_idx })}
                        className="text-left text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-700 text-slate-300 max-w-xs truncate"
                        title="Open this chat">
                        <span className="text-emerald-400 mr-1">[{s.n}]</span>{s.title}{s.updated ? <span className="text-slate-500"> · {niceDate(s.updated)}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <div className="sticky bottom-0 pb-6 pt-3 bg-slate-950">
        <div className="flex gap-2 items-end bg-slate-900 border border-slate-700 rounded-2xl p-2 focus-within:border-emerald-500">
          <textarea
            value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey} rows={1} autoFocus
            placeholder={ready ? 'Ask about your saved chats…  (Enter to send, Shift+Enter for a new line)' : 'Connect an AI service in Settings to start'}
            className="flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none max-h-40"
            style={{ height: Math.min(160, 36 + 20 * (input.split('\n').length - 1)) }}
          />
          {busy ? (
            <Button variant="secondary" onClick={stop} title="Stop"><Square size={14} /> Stop</Button>
          ) : (
            <Button onClick={() => send()} disabled={!input.trim()} title="Send"><Send size={15} /></Button>
          )}
        </div>
        <p className="text-[11px] text-slate-600 mt-2 text-center">Only the passages needed to answer are sent to the AI service. Answers can be wrong, so check the linked chats.</p>
      </div>
    </div>
  )
}
