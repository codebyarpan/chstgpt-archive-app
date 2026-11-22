import { useEffect, useState } from 'react'
import { MessagesSquare, Search as SearchIcon } from 'lucide-react'
import { api, ConversationRow, Group, Project, NO_PROJECT } from '../api'
import { Button, Card, Empty, ErrorNote, PageTitle, Spinner, useApp } from '../ui'
import { ChatRow } from './Home'

const PAGE = 50
const selectCls = 'px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-200 focus:outline-none focus:border-emerald-500'

export default function Chats() {
  const { openChat, version } = useApp()
  const [q, setQ] = useState('')
  const [project, setProject] = useState('')
  const [group, setGroup] = useState('')
  const [rows, setRows] = useState<ConversationRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [groups, setGroups] = useState<Group[]>([])

  useEffect(() => {
    api.projects().then(setProjects).catch(() => {})
    api.groups().then(setGroups).catch(() => {})
  }, [version])

  const load = async (offset = 0) => {
    setLoading(true)
    try {
      const r = await api.conversations({ q, project, group, limit: PAGE, offset })
      setRows(prev => (offset ? [...prev, ...r.results] : r.results))
      setTotal(r.total); setError('')
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }
  // Re-filter shortly after typing stops.
  useEffect(() => {
    const t = setTimeout(() => load(0), 250)
    return () => clearTimeout(t)
  }, [q, project, group, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = q || project || group

  return (
    <div>
      <PageTitle title="All chats" subtitle={total ? `${total} chat${total === 1 ? '' : 's'}${filtered ? ' match' : ' saved'}` : undefined} />
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <SearchIcon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by title…"
            className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
        {projects.some(p => p.name !== NO_PROJECT) && (
          <select value={project} onChange={e => setProject(e.target.value)} className={selectCls}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p.name} value={p.name}>{p.name === NO_PROJECT ? 'Not in a project' : p.name} ({p.count})</option>)}
          </select>
        )}
        {groups.length > 0 && (
          <select value={group} onChange={e => setGroup(e.target.value)} className={selectCls}>
            <option value="">All groups</option>
            {groups.map(g => <option key={g.id} value={g.name}>{g.name} ({g.count})</option>)}
          </select>
        )}
      </div>

      {error && <ErrorNote message={error} onRetry={() => load(0)} />}
      <Card>
        {loading && rows.length === 0 ? <Spinner /> : rows.length === 0 ? (
          filtered
            ? <Empty icon={SearchIcon} title="No chats match">Try a different word, or clear the filters.</Empty>
            : <Empty icon={MessagesSquare} title="No chats saved yet">Use the green archive button on chatgpt.com to save chats here.</Empty>
        ) : (
          <ul className="divide-y divide-slate-800">
            {rows.map(c => <ChatRow key={c.conversation_id} c={c} onClick={() => openChat(c.conversation_id)} />)}
          </ul>
        )}
      </Card>
      {rows.length < total && (
        <div className="text-center mt-4">
          <Button variant="secondary" busy={loading} onClick={() => load(rows.length)}>Show more</Button>
        </div>
      )}
    </div>
  )
}
