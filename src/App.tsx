import { useCallback, useEffect, useState } from 'react'
import { Home as HomeIcon, MessagesSquare, Search as SearchIcon, FolderOpen, Settings as SettingsIcon, Loader2, AlertTriangle, Archive } from 'lucide-react'
import Home from './pages/Home'
import Chats from './pages/Chats'
import Search from './pages/Search'
import Groups from './pages/Groups'
import Settings from './pages/Settings'
import ChatViewer from './ChatViewer'
import { Ctx, Page, useToasts, Button } from './ui'

const NAV: { id: Page; label: string; icon: any }[] = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'chats', label: 'All chats', icon: MessagesSquare },
  { id: 'search', label: 'Search', icon: SearchIcon },
  { id: 'groups', label: 'Groups', icon: FolderOpen },
  { id: 'settings', label: 'Settings & help', icon: SettingsIcon }
]

/** Shown until the background service answers (the first launch downloads its components). */
function StartupScreen({ status }: { status: AppStatus | null }) {
  const error = status?.phase === 'error'
  return (
    <div className="h-screen flex items-center justify-center bg-slate-950 px-8">
      <div className="absolute inset-x-0 top-0 h-10 drag" />
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-emerald-600/15 border border-emerald-700/40 flex items-center justify-center">
          {error ? <AlertTriangle size={30} className="text-amber-400" /> : <Archive size={30} className="text-emerald-400" />}
        </div>
        {error ? (
          <>
            <h1 className="text-xl font-semibold text-slate-50 mb-2">Something needs attention</h1>
            <p className="text-sm text-slate-300 leading-relaxed mb-6">{status?.error}</p>
            <div className="flex justify-center gap-3">
              <Button onClick={() => window.api?.retryStart()}>Try again</Button>
              <Button variant="secondary" onClick={() => window.api?.openLogs()}>Show details</Button>
            </div>
            <p className="text-xs text-slate-500 mt-6">If it keeps happening, send the files from "Show details" to the person who gave you this app.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-50 mb-2">{status?.slow ? 'Getting things ready…' : 'Starting…'}</h1>
            <div className="flex items-center justify-center gap-2 text-sm text-slate-300 mb-4">
              <Loader2 size={16} className="animate-spin text-emerald-400" /> {status?.detail || 'Starting…'}
            </div>
            {status?.slow && (
              <p className="text-sm text-slate-400 leading-relaxed">
                The first time you open the app it downloads a few components (about 150 MB).
                This can take a few minutes. Please keep the internet connected — you only have to wait once.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [chat, setChat] = useState<{ id: string; at?: number; terms?: string } | null>(null)
  const [version, setVersion] = useState(0)
  const { toast, view: toasts } = useToasts()

  useEffect(() => {
    if (!window.api) return
    window.api.getStatus().then(setStatus)
    const off = window.api.onStatus(setStatus)
    // The "slow" flag is time based, so refresh it while starting.
    const t = setInterval(() => window.api!.getStatus().then(setStatus), 3000)
    return () => { off(); clearInterval(t) }
  }, [])

  // ⌘K or ⌘F jumps to Search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && (e.key === 'k' || e.key === 'f')) { e.preventDefault(); setChat(null); setPage('search') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const changed = useCallback(() => setVersion(v => v + 1), [])
  const openChat = useCallback((id: string, opts?: { at?: number; terms?: string }) => setChat({ id, ...opts }), [])

  if (!window.api) {
    return <div className="p-10 text-slate-300">Please open this through the ChatGPT Archive app.</div>
  }
  if (!status || status.phase !== 'ready') return <StartupScreen status={status} />

  return (
    <Ctx.Provider value={{ go: setPage, openChat, toast, version, changed }}>
      <div className="flex h-screen bg-slate-950">
        <aside className="w-56 bg-slate-900/70 border-r border-slate-800 flex flex-col shrink-0">
          <div className="h-12 drag shrink-0" />
          <div className="px-5 mb-6 flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center"><Archive size={15} className="text-white" /></div>
            <p className="text-sm font-semibold text-slate-100">ChatGPT Archive</p>
          </div>
          <nav className="flex-1 space-y-1 px-3">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => { setPage(id); setChat(null) }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  page === id ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon size={17} /> {label}
              </button>
            ))}
          </nav>
          <div className="px-5 py-4 text-xs text-slate-500 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Running
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto relative">
          <div className="h-8 drag sticky top-0 z-10" />
          <div className="max-w-5xl mx-auto px-8 pb-12">
            {page === 'home' && <Home />}
            {page === 'chats' && <Chats />}
            {page === 'search' && <Search />}
            {page === 'groups' && <Groups />}
            {page === 'settings' && <Settings />}
          </div>
        </main>

        {chat && <ChatViewer key={chat.id} {...chat} onClose={() => setChat(null)} />}
        {toasts}
      </div>
    </Ctx.Provider>
  )
}
