import { useEffect, useState } from 'react'
import { Check, ExternalLink, KeyRound } from 'lucide-react'
import { Button, useApp } from './ui'

const field = 'w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500'

/** Settings → AI chatbot: choose Groq or xAI Grok, paste a key, pick a model. */
export default function AiSettings() {
  const { toast } = useApp()
  const [cfg, setCfg] = useState<AiConfig | null>(null)
  const [editing, setEditing] = useState(false)
  const [provider, setProvider] = useState<AiProviderId>('groq')
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[] | null>(null)
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api!.aiGet().then(c => {
      setCfg(c)
      if (c.provider) { setProvider(c.provider); setModel(c.model) }
      setEditing(!c.hasKey)
    })
  }, [])

  if (!cfg) return null
  const info = cfg.providers.find(p => p.id === provider)!

  // Step 1: check the key and fetch the models it may use.
  const check = async (useSaved = false) => {
    setBusy(true); setError(''); setModels(null)
    const r = await window.api!.aiTest(provider, useSaved ? undefined : key)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setModels(r.models)
    setModel(m => (r.models.includes(m) ? m : r.models[0]))
  }
  // Step 2: save key + model.
  const save = async () => {
    setBusy(true)
    const r = await window.api!.aiSave({ provider, key: key || undefined, model })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setCfg(r.config); setEditing(false); setKey(''); setModels(null)
    toast(`Connected to ${info.name}. Open "Ask AI" to start.`)
  }
  const remove = async () => {
    const c = await window.api!.aiClear()
    setCfg(c); setEditing(true); setKey(''); setModels(null); setModel('')
    toast('AI key removed from this Mac')
  }

  if (!editing && cfg.hasKey) {
    const name = cfg.providers.find(p => p.id === cfg.provider)?.name
    return (
      <div>
        <p className="text-sm text-emerald-300 flex items-center gap-2 mb-1"><Check size={16} /> Connected to {name}</p>
        <p className="text-xs text-slate-500 mb-4">Model: <span className="font-mono text-slate-300">{cfg.model}</span> · key {cfg.keyHint}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { setEditing(true); check(true) }}>Change model or service</Button>
          <Button variant="ghost" onClick={remove}>Remove key</Button>
        </div>
      </div>
    )
  }

  const switching = cfg.hasKey && cfg.provider !== provider
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Ask questions about your saved chats in plain language. The app finds the right chats and an AI service of your choice writes the answer.
        Only the passages needed for each question are sent to that service.
      </p>

      <div>
        <p className="text-xs text-slate-400 mb-2">1. Pick a service</p>
        <div className="grid grid-cols-2 gap-2">
          {cfg.providers.map(p => (
            <button key={p.id} onClick={() => { setProvider(p.id); setModels(null); setError('') }}
              className={`text-left rounded-xl border px-4 py-3 transition-colors ${provider === p.id ? 'border-emerald-600 bg-emerald-950/30' : 'border-slate-700 hover:border-slate-600'}`}>
              <p className="text-sm font-medium text-slate-100">{p.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{p.note}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-400 mb-2">
          2. Paste your {info.name} key{' '}
          <button className="text-emerald-400 underline inline-flex items-center gap-1" onClick={() => window.api!.openUrl(info.keyUrl)}>
            get a key <ExternalLink size={11} />
          </button>
          <span className="text-slate-500"> (sign in, create a key, copy it)</span>
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="password" value={key} onChange={e => { setKey(e.target.value); setModels(null) }}
              placeholder={cfg.hasKey && !switching ? `Keep the saved key (${cfg.keyHint}), or paste a new one` : 'Paste the key here'}
              className={`${field} pl-9`} />
          </div>
          <Button variant="secondary" busy={busy && !models} disabled={!key.trim() && !(cfg.hasKey && !switching)}
            onClick={() => check(!key.trim())}>Check key</Button>
        </div>
        <p className="text-xs text-slate-500 mt-1">The key is stored only on this Mac.</p>
      </div>

      {error && <p className="text-sm text-amber-300">{error}</p>}

      {models && (
        <div>
          <p className="text-xs text-slate-400 mb-2">3. Pick a model (the first one is a good choice)</p>
          <div className="flex gap-2">
            <select value={model} onChange={e => setModel(e.target.value)} className={field}>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <Button busy={busy} onClick={save}>Save</Button>
          </div>
        </div>
      )}

      {cfg.hasKey && <Button variant="ghost" onClick={() => { setEditing(false); setError(''); setModels(null); setProvider(cfg.provider!); setModel(cfg.model) }}>Cancel</Button>}
    </div>
  )
}
