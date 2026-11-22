import { useEffect, useRef, useState } from 'react'
import { X, ExternalLink, Plus, User, Sparkles, Wrench, Check, Copy, Trash2 } from 'lucide-react'
import { api, Conversation, Group, niceDate, projectLabel } from './api'
import { Button, Chip, ErrorNote, Markdown, Spinner, searchTerms, useApp } from './ui'

/** Full-height panel showing one saved chat. */
export default function ChatViewer({ id, at, terms, onClose }: { id: string; at?: number; terms?: string; onClose: () => void }) {
  const { toast, changed, version } = useApp()
  const [conv, setConv] = useState<Conversation | null>(null)
  const [error, setError] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [adding, setAdding] = useState(false)
  const [newGroup, setNewGroup] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [copied, setCopied] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const highlight = terms ? searchTerms(terms) : undefined

  const load = () => {
    setError('')
    api.conversation(id).then(setConv).catch(e => setError(e.message))
    api.groups().then(setGroups).catch(() => {})
  }
  useEffect(load, [id, version]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Jump to the message a search result pointed at.
  useEffect(() => {
    if (!conv || at === undefined) return
    const el = scroller.current?.querySelector(`[data-idx="${at}"]`)
    el?.scrollIntoView({ block: 'start' })
  }, [conv, at])

  const addTo = async (g: { id: number; name: string }) => {
    try {
      await api.addToGroup(g.id, id)
      toast(`Added to "${g.name}"`)
      setAdding(false); setNewGroup(''); changed()
    } catch (e: any) { toast(e.message, 'error') }
  }
  const createAndAdd = async () => {
    const name = newGroup.trim()
    if (!name) return
    try { addTo(await api.createGroup(name)) } catch (e: any) { toast(e.message, 'error') }
  }
  const removeFrom = async (g: { id: number; name: string }) => {
    try {
      await api.removeFromGroup(g.id, id)
      toast(`Removed from "${g.name}"`)
      changed()
    } catch (e: any) { toast(e.message, 'error') }
  }

  const copyAll = () => {
    if (!conv) return
    const who = (r: string) => (r === 'user' ? 'You' : r === 'assistant' ? 'ChatGPT' : 'Tool')
    navigator.clipboard.writeText(`# ${conv.title}\n\n` + conv.messages.map(m => `**${who(m.role)}:**\n\n${m.text}`).join('\n\n---\n\n'))
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }
  const deleteChat = async () => {
    try {
      await api.deleteConversation(id)
      toast('Chat deleted from the archive. (It is still in ChatGPT.)')
      changed(); onClose()
    } catch (e: any) { toast(e.message, 'error') }
  }

  const inGroup = new Set(conv?.groups.map(g => g.id))

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-[min(860px,92vw)] h-full bg-slate-950 border-l border-slate-800 flex flex-col shadow-2xl">
        <div className="px-6 pt-10 pb-4 border-b border-slate-800 shrink-0">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-slate-50 select-text">{conv?.title || ' '}</h2>
              {conv && (
                <p className="text-xs text-slate-400 mt-1">
                  {projectLabel(conv.project) && <>Project: <span className="text-slate-300">{conv.project}</span> · </>}
                  {niceDate(conv.updated)} · {conv.messages.length} messages
                </p>
              )}
            </div>
            <Button variant="secondary" onClick={copyAll} disabled={!conv} title="Copy the whole chat as text">
              {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button variant="secondary" onClick={() => window.api?.openInChatGPT(id)} title="Open this chat on chatgpt.com">
              <ExternalLink size={15} /> Open in ChatGPT
            </Button>
            <button onClick={() => setConfirmDelete(true)} className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-red-400" title="Delete from the archive"><Trash2 size={17} /></button>
            <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white" title="Close (Esc)"><X size={18} /></button>
          </div>
          {confirmDelete && (
            <div className="mt-3 flex items-center gap-3 px-4 py-3 rounded-xl bg-red-950/40 border border-red-900/60 text-sm text-red-100">
              <span className="flex-1">Delete this chat from the archive? It stays in ChatGPT, and you can save it again later.</span>
              <Button variant="danger" className="py-1.5" onClick={deleteChat}>Delete</Button>
              <Button variant="ghost" className="py-1.5" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </div>
          )}
          {conv && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className="text-xs text-slate-500">Groups:</span>
              {conv.groups.length === 0 && <span className="text-xs text-slate-500 italic">none</span>}
              {conv.groups.map(g => <Chip key={g.id} tone="green" onRemove={() => removeFrom(g)}>{g.name}</Chip>)}
              <div className="relative">
                <button onClick={() => setAdding(a => !a)} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-dashed border-slate-600 text-slate-300 hover:border-emerald-500 hover:text-emerald-300">
                  <Plus size={12} /> Add to group
                </button>
                {adding && (
                  <div className="absolute left-0 top-7 z-10 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2">
                    {groups.filter(g => !inGroup.has(g.id)).map(g => (
                      <button key={g.id} onClick={() => addTo(g)} className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-slate-800">{g.name}</button>
                    ))}
                    {groups.length > 0 && groups.every(g => inGroup.has(g.id)) && <p className="px-3 py-2 text-xs text-slate-500">Already in every group.</p>}
                    <div className="flex gap-1 mt-1 pt-2 border-t border-slate-800">
                      <input
                        autoFocus value={newGroup} onChange={e => setNewGroup(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && createAndAdd()}
                        placeholder="New group name"
                        className="flex-1 min-w-0 px-2 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                      />
                      <button onClick={createAndAdd} disabled={!newGroup.trim()} className="px-2 rounded-lg bg-emerald-600 text-white disabled:opacity-40"><Check size={15} /></button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div ref={scroller} className="flex-1 overflow-y-auto px-6 py-6 space-y-5 select-text">
          {error && <ErrorNote message={error} onRetry={load} />}
          {!conv && !error && <Spinner />}
          {conv?.messages.map(m => {
            const isUser = m.role === 'user'
            const isTool = m.role === 'tool' || m.role === 'system'
            const Icon = isUser ? User : isTool ? Wrench : Sparkles
            return (
              <div key={m.idx} data-idx={m.idx} className={`scroll-mt-4 flex gap-3 ${at === m.idx ? 'ring-1 ring-amber-400/40 rounded-xl p-2 -m-2' : ''}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-sky-600/30 text-sky-300' : isTool ? 'bg-slate-800 text-slate-400' : 'bg-emerald-600/25 text-emerald-300'}`}>
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-400 mb-1">{isUser ? 'You' : isTool ? 'Tool' : 'ChatGPT'}</p>
                  <div className={`rounded-xl px-4 py-2 ${isUser ? 'bg-sky-950/40 border border-sky-900/40' : isTool ? 'bg-slate-900/60 opacity-80' : 'bg-slate-900 border border-slate-800'} break-words`}>
                    <Markdown text={m.text} terms={highlight} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
