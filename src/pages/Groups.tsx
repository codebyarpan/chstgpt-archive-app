import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, FolderOpen, ChevronRight, ChevronDown, X, Pencil, Check } from 'lucide-react'
import { api, ConversationRow, Group, niceDate } from '../api'
import { Button, Card, Empty, ErrorNote, PageTitle, Spinner, useApp } from '../ui'

export default function Groups() {
  const { openChat, toast, version, changed } = useApp()
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [members, setMembers] = useState<ConversationRow[] | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null)

  const rename = async () => {
    if (!renaming || !renaming.name.trim()) return
    try {
      await api.renameGroup(renaming.id, renaming.name.trim())
      toast('Group renamed'); setRenaming(null); changed()
    } catch (e: any) { toast(e.message, 'error') }
  }

  const load = useCallback(() => {
    api.groups().then(g => { setGroups(g); setError('') }).catch(e => setError(e.message))
  }, [])
  useEffect(load, [load, version])

  const loadMembers = useCallback((g: Group) => {
    setMembers(null)
    api.conversations({ group: g.name, limit: 200 }).then(r => setMembers(r.results)).catch(e => setError(e.message))
  }, [])
  useEffect(() => {
    const g = groups?.find(x => x.id === open)
    if (g) loadMembers(g)
  }, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  const createGroup = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      await api.createGroup(name)
      setNewName(''); toast(`Group "${name}" created`); changed()
    } catch (e: any) { toast(e.message, 'error') } finally { setCreating(false) }
  }

  const deleteGroup = async (g: Group) => {
    try {
      await api.deleteGroup(g.id)
      if (open === g.id) setOpen(null)
      setConfirmDelete(null); toast(`Group "${g.name}" deleted. Its chats are still saved.`); changed()
    } catch (e: any) { toast(e.message, 'error') }
  }

  const removeChat = async (g: Group, c: ConversationRow) => {
    try {
      await api.removeFromGroup(g.id, c.conversation_id)
      toast(`Removed from "${g.name}"`); changed()
    } catch (e: any) { toast(e.message, 'error') }
  }

  const toggle = (g: Group) => {
    if (open === g.id) { setOpen(null); return }
    setOpen(g.id); loadMembers(g)
  }

  return (
    <div>
      <PageTitle title="Groups" subtitle="Folders for your chats. A chat can be in several groups. Add chats from Chrome, or with “Add to group” when reading one." />

      <form onSubmit={e => { e.preventDefault(); createGroup() }} className="flex gap-3 mb-6">
        <input
          value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name for a new group, e.g. Work"
          className="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
        />
        <Button type="submit" busy={creating} disabled={!newName.trim()}><Plus size={15} /> Create group</Button>
      </form>

      {error && <ErrorNote message={error} onRetry={load} />}

      {groups === null ? <Spinner /> : groups.length === 0 ? (
        <Card><Empty icon={FolderOpen} title="No groups yet">Create one above, or pick a group when saving chats from Chrome.</Empty></Card>
      ) : (
        <div className="space-y-3">
          {groups.map(g => (
            <Card key={g.id} className="overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4">
                {renaming?.id === g.id ? (
                  <form onSubmit={e => { e.preventDefault(); rename() }} className="flex items-center gap-2 flex-1">
                    <FolderOpen size={18} className="text-emerald-400 ml-7" />
                    <input
                      autoFocus value={renaming.name} onChange={e => setRenaming({ id: g.id, name: e.target.value })}
                      onKeyDown={e => e.key === 'Escape' && setRenaming(null)}
                      className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                    <Button type="submit" className="py-1.5"><Check size={15} /> Save</Button>
                    <Button type="button" variant="ghost" className="py-1.5" onClick={() => setRenaming(null)}>Cancel</Button>
                  </form>
                ) : (
                  <button onClick={() => toggle(g)} className="flex items-center gap-3 text-left flex-1">
                    {open === g.id ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                    <FolderOpen size={18} className="text-emerald-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-100">{g.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{g.count} chat{g.count !== 1 ? 's' : ''}</p>
                    </div>
                  </button>
                )}
                {renaming?.id !== g.id && confirmDelete !== g.id && (
                  <button onClick={() => setRenaming({ id: g.id, name: g.name })} className="text-slate-500 hover:text-slate-200 p-2 rounded-lg hover:bg-slate-800" title="Rename group">
                    <Pencil size={15} />
                  </button>
                )}
                {confirmDelete === g.id ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-300">Delete this group? Chats stay saved.</span>
                    <Button variant="danger" className="py-1.5" onClick={() => deleteGroup(g)}>Delete</Button>
                    <Button variant="ghost" className="py-1.5" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                  </div>
                ) : renaming?.id === g.id ? null : (
                  <button onClick={() => setConfirmDelete(g.id)} className="text-slate-500 hover:text-red-400 p-2 rounded-lg hover:bg-slate-800" title="Delete group">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              {open === g.id && (
                <ul className="border-t border-slate-800 divide-y divide-slate-800">
                  {members === null && <li><Spinner /></li>}
                  {members?.length === 0 && <li className="px-12 py-3 text-sm text-slate-500">No chats in this group yet.</li>}
                  {members?.map(c => (
                    <li key={c.conversation_id} className="flex items-center hover:bg-slate-800/50">
                      <button onClick={() => openChat(c.conversation_id)} className="flex-1 text-left pl-12 pr-3 py-3 min-w-0">
                        <p className="text-sm text-slate-200 truncate">{c.title}</p>
                        <p className="text-xs text-slate-500">{niceDate(c.updated)} · {c.message_count} messages</p>
                      </button>
                      <button onClick={() => removeChat(g, c)} className="mr-4 p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-700" title="Remove from this group (the chat stays saved)">
                        <X size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
