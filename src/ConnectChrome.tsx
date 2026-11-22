import { useState, ReactNode } from 'react'
import { CheckCircle2, Chrome, FolderOpen, MousePointerClick, ToggleRight } from 'lucide-react'
import { Button } from './ui'

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold ${done ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-200 border border-slate-700'}`}>
        {done ? <CheckCircle2 size={16} /> : n}
      </div>
      <div className="flex-1 pb-6">
        <p className="text-sm font-medium text-slate-100 mb-1">{title}</p>
        <div className="text-sm text-slate-400 leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

/** Step-by-step guide for adding the Chrome extension (it has to be loaded by hand). */
export default function ConnectChrome({ connected }: { connected: boolean }) {
  const [opened, setOpened] = useState<null | boolean>(null)
  const [prepared, setPrepared] = useState(false)

  if (connected) {
    return (
      <div className="flex items-center gap-3 text-sm text-emerald-300">
        <CheckCircle2 size={18} /> Chrome is connected. On chatgpt.com, click the green archive button at the bottom-right to save chats.
      </div>
    )
  }

  return (
    <div>
      <Step n={1} title="Open Chrome's extensions page" done={opened !== null}>
        <Button variant="secondary" className="mt-1" onClick={async () => setOpened(await window.api!.openChromeExtensions())}>
          <Chrome size={15} /> Open in Chrome
        </Button>
        {opened === false && (
          <p className="mt-2 text-amber-300">
            Chrome could not be opened automatically. Open Google Chrome, click the address bar, and paste
            (⌘V) — we copied <span className="font-mono text-slate-200">chrome://extensions</span> for you — then press Return.
          </p>
        )}
        {opened && <p className="mt-2">If the page didn't appear, click Chrome's address bar, paste (⌘V) and press Return.</p>}
      </Step>
      <Step n={2} title='Turn on "Developer mode"'>
        <span className="inline-flex items-center gap-1">It's the switch in the top-right corner of that page <ToggleRight size={16} className="text-sky-400" />.</span>
        <span className="block mt-1 text-slate-500">This only lets Chrome load an extension from a folder on your Mac; it doesn't change anything else.</span>
      </Step>
      <Step n={3} title="Add the extension" done={prepared}>
        <Button variant="secondary" className="mt-1" onClick={async () => { await window.api!.extensionPrepare(); setPrepared(true) }}>
          <FolderOpen size={15} /> Show the extension folder
        </Button>
        <p className="mt-2">
          A Finder window opens with the folder <b className="text-slate-200">ChatGPT Archive Extension</b> selected.
          <span className="inline-flex items-center gap-1"> Drag that folder onto the Chrome extensions page <MousePointerClick size={14} />.</span>
        </p>
        <p className="mt-1 text-slate-500">
          Or: click <b className="text-slate-300">Load unpacked</b> in Chrome, choose your home folder (the one with the house icon) and pick
          "ChatGPT Archive Extension". Please keep that folder where it is.
        </p>
      </Step>
      <Step n={4} title="Go to chatgpt.com">
        <Button variant="secondary" className="mt-1" onClick={() => window.api!.openUrl('https://chatgpt.com')}>Open ChatGPT</Button>
        <p className="mt-2">
          Reload the page if it was already open. A round green archive button appears at the bottom-right.
          Click it, tick the chats you want and press <b className="text-slate-200">Save</b>. This step turns green once Chrome has connected.
        </p>
      </Step>
    </div>
  )
}
