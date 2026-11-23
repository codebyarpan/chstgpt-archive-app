import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Chrome, HardDrive, Server } from 'lucide-react'
import { Button, useApp } from './ui'

const field = 'w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500'
// Switching storage briefly shows the "Connecting…" screen, which unmounts this
// page; the outcome is kept here so it can be shown when the page comes back.
const NOTICE = 'storageNotice'
interface Notice { kind: 'moved' | 'connected' | 'local'; text: string; chromeReload: boolean }

function ChromeReloadNote() {
  return (
    <div className="mt-3 px-4 py-3 rounded-xl bg-amber-950/30 border border-amber-900/50 text-sm text-amber-100">
      <p className="mb-2">
        <b>One step in Chrome:</b> open the extensions page and click the reload arrow ↻ on <b>ChatGPT Archive</b>,
        so it saves new chats to the right place.
      </p>
      <Button variant="secondary" onClick={() => window.api!.openChromeExtensions()}><Chrome size={15} /> Open Chrome extensions</Button>
    </div>
  )
}

/** Settings → Storage: keep the chats on this Mac, or move them to your own server. */
export default function StorageSettings() {
  const { toast, changed } = useApp()
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [form, setForm] = useState(false)
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [check, setCheck] = useState<ServerCheck | null>(null)
  const [busy, setBusy] = useState<'' | 'check' | 'move' | 'connect' | 'free' | 'back'>('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [confirmBack, setConfirmBack] = useState(false)
  const [confirmFree, setConfirmFree] = useState(false)

  const load = () => window.api!.storageInfo().then(setInfo)
  useEffect(() => {
    load()
    try { const n = sessionStorage.getItem(NOTICE); if (n) { setNotice(JSON.parse(n)); sessionStorage.removeItem(NOTICE) } } catch { /* ignore */ }
    return window.api!.onMoveEvent(ev => {
      if (ev.type === 'progress') setProgress({ done: ev.done, total: ev.total })
      if (ev.type === 'error') { setBusy(''); setProgress(null); setError(ev.error) }
      if (ev.type === 'done') {
        const n: Notice = { kind: 'moved', chromeReload: ev.extensionInstalled,
          text: `Moved ${ev.result.chats} chat${ev.result.chats === 1 ? '' : 's'} and checked that every one arrived. From now on this app and Chrome use your server.` }
        sessionStorage.setItem(NOTICE, JSON.stringify(n))
        setNotice(n); setBusy(''); setProgress(null); setForm(false)
      }
    })
  }, [])

  if (!info) return null
  const keep = (n: Notice) => { sessionStorage.setItem(NOTICE, JSON.stringify(n)); setNotice(n) }

  const doCheck = async () => {
    setBusy('check'); setError(''); setCheck(null)
    const r = await window.api!.serverTest(url, code)
    setBusy('')
    if (r.ok) { setCheck(r); setUrl(r.url) } else setError(r.error)
  }
  const doMove = async () => {
    setBusy('move'); setError(''); setProgress({ done: 0, total: 0 })
    const r = await window.api!.serverMove(url, code)
    if (!r.ok) { setBusy(''); setProgress(null); setError(r.error) }
  }
  const doConnect = async () => {
    setBusy('connect'); setError('')
    const r = await window.api!.serverConnect(url, code)
    setBusy('')
    if (!r.ok) { setError(r.error); return }
    keep({ kind: 'connected', chromeReload: r.extensionInstalled,
      text: `Connected to your server (${r.chats} chat${r.chats === 1 ? '' : 's'} there). Nothing was copied from this Mac.` })
  }
  const doFree = async () => {
    setConfirmFree(false); setBusy('free'); setError(''); setProgress(null)
    const r = await window.api!.freeLocalSpace()
    setBusy(''); setProgress(null)
    if (r.ok) { toast(r.freedMB ? `Freed about ${r.freedMB} MB on this Mac` : 'Nothing left to remove'); load(); changed() }
    else setError(r.error)
  }
  const doBack = async () => {
    setBusy('back'); setError('')
    const r = await window.api!.serverDisconnect()
    setBusy(''); setConfirmBack(false)
    keep({ kind: 'local', chromeReload: r.extensionInstalled,
      text: r.hasLocalCopy
        ? "Back on this Mac. It uses its own copy, which doesn't include chats saved to the server since the move."
        : 'Back on this Mac, starting with an empty archive. Your chats are still on the server.' })
  }

  const noticeView = notice && (
    <div className="mb-4">
      <p className="text-sm text-emerald-300 flex items-start gap-2"><Check size={16} className="shrink-0 mt-0.5" /> {notice.text}</p>
      {notice.chromeReload && <ChromeReloadNote />}
    </div>
  )
  const progressView = progress && (
    <div className="mt-3">
      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 5}%` }} />
      </div>
      <p className="text-xs text-slate-400 mt-1">
        {progress.total && progress.done >= progress.total ? 'Checking that every chat arrived…'
          : progress.total ? `Copying ${progress.done} of ${progress.total} chats…` : 'Connecting…'}
      </p>
    </div>
  )
  const errorView = error && <p className="mt-3 text-sm text-amber-300 flex items-start gap-2"><AlertTriangle size={15} className="shrink-0 mt-0.5" /> {error}</p>

  // ── Server mode ──
  if (info.mode === 'server') {
    const localMB = Math.round((info.dataMB + info.modelMB) * 10) / 10
    return (
      <div>
        {noticeView}
        <p className="text-sm text-slate-100 flex items-center gap-2 mb-1"><Server size={16} className="text-emerald-400" /> Your chats are stored on your server</p>
        <p className="text-xs text-slate-500 font-mono mb-3 select-text">{info.server}</p>
        <p className="text-sm text-slate-400 mb-4">
          Chrome saves new chats straight to the server, and Search, Ask AI and the connect links all use it.
          You can open the archive from any Mac with this app by connecting it to the same server.
        </p>
        {localMB > 0 && (
          <div className="mb-4">
            <p className="text-sm text-slate-300 mb-2">This Mac still keeps a copy (about {localMB} MB).</p>
            {confirmFree ? (
              <div className="px-4 py-3 rounded-xl bg-red-950/30 border border-red-900/50 text-sm text-red-100">
                <p className="mb-3">
                  Delete the copy on this Mac (about {localMB} MB)? The app first checks once more that your server has every chat,
                  and deletes nothing if anything is missing. This can't be undone, but your chats stay on the server.
                </p>
                <div className="flex gap-2">
                  <Button variant="danger" onClick={doFree}>Check, then delete</Button>
                  <Button variant="ghost" onClick={() => setConfirmFree(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <Button variant="secondary" busy={busy === 'free'} onClick={() => setConfirmFree(true)}><HardDrive size={15} /> Free up space on this Mac</Button>
                <p className="text-xs text-slate-500 mt-1">Removes the local copy and the smart-search model, after checking the server has every chat.</p>
              </>
            )}
            {busy === 'free' && progressView}
          </div>
        )}
        {errorView}
        {confirmBack ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-300">
              Switch back to this Mac? The chats on your server stay there.{' '}
              {info.hasLocalCopy ? 'This Mac uses its own older copy.' : 'This Mac starts with an empty archive.'}
            </span>
            <Button busy={busy === 'back'} onClick={doBack}>Switch back</Button>
            <Button variant="ghost" onClick={() => setConfirmBack(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="ghost" className="mt-2" onClick={() => setConfirmBack(true)}>Use this Mac instead</Button>
        )}
      </div>
    )
  }

  // ── Local mode ──
  return (
    <div>
      {noticeView}
      <p className="text-sm text-slate-100 flex items-center gap-2 mb-1"><HardDrive size={16} className="text-emerald-400" /> Your chats are stored on this Mac</p>
      <p className="text-sm text-slate-400 mb-4">
        Uses about {Math.round((info.dataMB + info.modelMB) * 10) / 10} MB here ({info.dataMB} MB of chats, {info.modelMB} MB for smart search).
        To save space, or to use the archive from several computers, move it to your own server.
      </p>

      {!form ? (
        <Button variant="secondary" onClick={() => { setForm(true); setNotice(null) }}><Server size={15} /> Move to my own server…</Button>
      ) : (
        <div className="space-y-3 rounded-xl border border-slate-800 p-4">
          <p className="text-sm text-slate-400">
            The server must be running the ChatGPT Archive server (whoever set it up has its address and access code).
            Afterwards, Chrome saves straight to the server and you can free up the space on this Mac.
          </p>
          <div>
            <p className="text-xs text-slate-400 mb-1">Server address</p>
            <input value={url} onChange={e => { setUrl(e.target.value); setCheck(null) }} placeholder="https://archive.example.com" className={field} />
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">Access code <span className="text-slate-500">(ARCHIVE_TOKEN in the server's settings)</span></p>
            <input type="password" value={code} onChange={e => { setCode(e.target.value); setCheck(null) }} placeholder="Paste the access code" className={field} />
          </div>
          {!check?.ok ? (
            <div className="flex gap-2">
              <Button busy={busy === 'check'} disabled={!url.trim() || !code.trim()} onClick={doCheck}>Check connection</Button>
              <Button variant="ghost" onClick={() => { setForm(false); setError(''); setCheck(null) }}>Cancel</Button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-emerald-300 flex items-center gap-2 mb-3">
                <Check size={16} /> Connected. The server has {check.chats} chat{check.chats === 1 ? '' : 's'} right now.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button busy={busy === 'move'} disabled={!!busy} onClick={doMove}>Move my chats to the server</Button>
                <Button variant="secondary" busy={busy === 'connect'} disabled={!!busy} onClick={doConnect}
                  title="For a second Mac: use the server without copying this Mac's chats">
                  Just connect (my chats are already there)
                </Button>
                <Button variant="ghost" disabled={!!busy} onClick={() => { setForm(false); setError(''); setCheck(null) }}>Cancel</Button>
              </div>
              <p className="text-xs text-slate-500 mt-2">Moving copies every chat, group and project name, then checks each one arrived. Nothing on this Mac is deleted.</p>
              {busy === 'move' && progressView}
            </div>
          )}
          {errorView}
        </div>
      )}
    </div>
  )
}
