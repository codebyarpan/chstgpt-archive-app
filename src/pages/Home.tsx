import { useCallback, useEffect, useState } from 'react'
import { MessagesSquare, FolderOpen, Layers, ChevronRight, Search as SearchIcon, Sparkles } from 'lucide-react'
import { api, ConversationRow, Stats, niceDate, projectLabel, NO_PROJECT } from '../api'
import { Card, Chip, ErrorNote, PageTitle, useApp } from '../ui'
import ConnectChrome from '../ConnectChrome'

export function ChatRow({ c, onClick }: { c: ConversationRow; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="w-full text-left px-5 py-3.5 hover:bg-slate-800/60 transition-colors flex items-center gap-3 group">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-100 truncate">{c.title}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {projectLabel(c.project) && <Chip>{c.project}</Chip>}
            {c.groups && c.groups.split(', ').map(g => <Chip key={g} tone="green">{g}</Chip>)}
            <span className="text-xs text-slate-500">{niceDate(c.updated)} · {c.message_count} messages</span>
          </div>
        </div>
        <ChevronRight size={16} className="text-slate-600 group-hover:text-slate-300" />
      </button>
    </li>
  )
}

export default function Home() {
  const { go, openChat, version } = useApp()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recent, setRecent] = useState<ConversationRow[]>([])
  const [error, setError] = useState('')
  const [quick, setQuick] = useState('')
  const [projects, setProjects] = useState<number | undefined>()

  const load = useCallback(async () => {
    try {
      const [s, c, p] = await Promise.all([api.stats(), api.conversations({ limit: 8 }), api.projects()])
      setStats(s); setRecent(c.results); setProjects(p.filter(x => x.name !== NO_PROJECT).length); setError('')
    } catch (e: any) { setError(e.message) }
  }, [])

  useEffect(() => {
    load()
    // New chats sent from Chrome show up without pressing anything.
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load, version])

  const connected = !!stats?.extension_last_seen
  const hasChats = (stats?.conversations ?? 0) > 0
  const setupDone = connected && hasChats

  return (
    <div>
      <PageTitle title="Home" subtitle="Your saved ChatGPT conversations, searchable in one place." />
      {error && <ErrorNote message={error} onRetry={load} />}

      {stats && !setupDone && (
        <Card className="p-6 mb-6 border-emerald-800/50">
          <h2 className="text-base font-semibold text-slate-50 mb-1">Let's get you set up</h2>
          <p className="text-sm text-slate-400 mb-6">
            A small Chrome add-on saves your chats from chatgpt.com into this app. It takes about two minutes, once.
          </p>
          <ConnectChrome connected={connected} />
          {connected && !hasChats && (
            <p className="text-sm text-slate-300 mt-4">
              Now go to <button className="text-emerald-400 underline" onClick={() => window.api!.openUrl('https://chatgpt.com')}>chatgpt.com</button>,
              click the green archive button at the bottom-right, tick some chats and press <b>Save</b>.
            </p>
          )}
        </Card>
      )}

      {hasChats && (
        <form
          onSubmit={e => { e.preventDefault(); if (quick.trim()) { sessionStorage.setItem('quickSearch', quick.trim()); go('search') } }}
          className="relative mb-6"
        >
          <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={quick} onChange={e => setQuick(e.target.value)}
            placeholder="Search everything you've talked about…"
            className="w-full pl-12 pr-4 py-3.5 bg-slate-900 border border-slate-700 rounded-2xl text-base text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </form>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { icon: MessagesSquare, label: 'Chats saved', value: stats?.conversations, page: 'chats' as const },
          { icon: FolderOpen, label: 'Groups', value: stats?.groups, page: 'groups' as const },
          { icon: Layers, label: 'ChatGPT projects', value: projects, page: 'chats' as const }
        ].map(({ icon: Icon, label, value, page }) => (
          <button key={label} onClick={() => go(page)} className="text-left bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 transition-colors">
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-2"><Icon size={15} /> {label}</div>
            <p className="text-3xl font-semibold text-slate-50">{value ?? '—'}</p>
          </button>
        ))}
      </div>

      {stats?.embedding.running && (
        <p className="mb-4 text-xs text-slate-500 flex items-center gap-2">
          <Sparkles size={13} className="text-emerald-500" />
          Preparing smart search for your newest chats ({stats.embedded_chunks} of {stats.chunks} passages)… Search already works meanwhile.
        </p>
      )}

      <Card>
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Recently saved chats</h2>
          {hasChats && <button onClick={() => go('chats')} className="text-xs text-emerald-400 hover:text-emerald-300">See all</button>}
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-slate-500 p-5">No chats saved yet. Once Chrome is connected, saved chats appear here automatically.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {recent.map(c => <ChatRow key={c.conversation_id} c={c} onClick={() => openChat(c.conversation_id)} />)}
          </ul>
        )}
      </Card>
    </div>
  )
}
