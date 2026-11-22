import { useEffect, useState } from 'react'
import { Search as SearchIcon, SearchX, Sparkles } from 'lucide-react'
import { api, Group, SearchHit, niceDate, projectLabel } from '../api'
import { Button, Card, Chip, Empty, ErrorNote, Highlight, PageTitle, plainText, searchTerms, useApp } from '../ui'

export default function Search() {
  const { openChat } = useApp()
  const [query, setQuery] = useState(() => sessionStorage.getItem('quickSearch') || '')
  const [group, setGroup] = useState('')
  const [results, setResults] = useState<SearchHit[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState('')
  const [smart, setSmart] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { api.groups().then(setGroups).catch(() => {}) }, [])

  const doSearch = async (q = query) => {
    if (!q.trim()) return
    setLoading(true); setError('')
    try {
      const data = await api.search({ q, group: group || undefined, limit: 30 })
      setResults(data.results); setSmart(data.semantic)
    } catch (e: any) {
      setResults([]); setError(e.message)
    } finally {
      setLoading(false); setSearched(q)
    }
  }

  // Arriving from the search box on Home.
  useEffect(() => {
    const q = sessionStorage.getItem('quickSearch')
    if (q) { sessionStorage.removeItem('quickSearch'); doSearch(q) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (searched) doSearch(searched) }, [group]) // eslint-disable-line react-hooks/exhaustive-deps

  const terms = searchTerms(searched)

  return (
    <div>
      <PageTitle title="Search" subtitle="Type a few words or a question. Results include chats that mean the same thing, even if they use other words." />
      <form onSubmit={e => { e.preventDefault(); doSearch() }} className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            autoFocus value={query} onChange={e => setQuery(e.target.value)}
            placeholder="e.g. how much does ChatGPT Plus cost   (shortcut: ⌘K)"
            className="w-full pl-12 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-base text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
        {groups.length > 0 && (
          <select value={group} onChange={e => setGroup(e.target.value)}
            className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-200 focus:outline-none focus:border-emerald-500">
            <option value="">All groups</option>
            {groups.map(g => <option key={g.id} value={g.name}>{g.name}</option>)}
          </select>
        )}
        <Button type="submit" busy={loading} disabled={!query.trim()} className="px-6">Search</Button>
      </form>

      {error && <ErrorNote message={error} onRetry={() => doSearch()} />}

      {searched && !loading && !error && results.length === 0 && (
        <Card><Empty icon={SearchX} title={`Nothing found for "${searched}"`}>Try other words, fewer words, or check the spelling.</Empty></Card>
      )}

      {results.length > 0 && (
        <p className="text-sm text-slate-400 mb-3">
          {results.length} chat{results.length === 1 ? '' : 's'} found. Click one to read it.
          {!smart && <span className="text-slate-500"> (Smart search is still getting ready, so only exact words are matched for now.)</span>}
        </p>
      )}

      <div className="space-y-3">
        {results.map(r => (
          <button
            key={`${r.conversation_id}-${r.message_idx}`}
            onClick={() => openChat(r.conversation_id, { at: r.message_idx, terms: searched })}
            className="w-full text-left bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-emerald-700/60 transition-colors"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <p className="text-sm font-semibold text-slate-100">{r.title}</p>
              <span className="text-xs text-slate-500 shrink-0">{niceDate(r.updated)}</span>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed line-clamp-3 select-text">
              <Highlight text={plainText(r.snippet)} terms={terms} />
            </p>
            <div className="flex items-center gap-2 mt-3">
              {projectLabel(r.project) && <Chip>{r.project}</Chip>}
              {r.match === 'meaning' && (
                <span className="inline-flex items-center gap-1 text-xs text-sky-300"><Sparkles size={12} /> Similar meaning</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {!searched && (
        <Card className="p-6">
          <p className="text-sm text-slate-300 mb-2">Tips</p>
          <ul className="text-sm text-slate-400 space-y-1 list-disc pl-5">
            <li>Ask like you would ask a person: "what did we decide about the logo?"</li>
            <li>Pick a group on the right to search only inside it.</li>
            <li>Highlighted words show where your search matched.</li>
          </ul>
        </Card>
      )}
    </div>
  )
}
