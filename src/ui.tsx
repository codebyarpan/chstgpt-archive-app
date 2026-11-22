import { createContext, useCallback, useContext, useState, ReactNode, ButtonHTMLAttributes, Fragment } from 'react'
import { Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react'

// ── Navigation + "open a chat" shared by every page ──────────────────────────
export type Page = 'home' | 'chats' | 'search' | 'groups' | 'settings'
interface AppCtx {
  go: (p: Page) => void
  openChat: (id: string, opts?: { at?: number; terms?: string }) => void
  toast: (msg: string, kind?: 'ok' | 'error') => void
  /** Bumped whenever chats/groups change, so lists reload. */
  version: number
  changed: () => void
}
export const Ctx = createContext<AppCtx>(null as unknown as AppCtx)
export const useApp = () => useContext(Ctx)

// ── Buttons ───────────────────────────────────────────────────────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-emerald-600 hover:bg-emerald-500 text-white',
  secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700',
  ghost: 'hover:bg-slate-800 text-slate-300',
  danger: 'bg-red-600/90 hover:bg-red-500 text-white'
}
export function Button({ variant = 'primary', className = '', busy, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    >
      {busy && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-slate-900 border border-slate-800 rounded-2xl ${className}`}>{children}</div>
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-50">{title}</h1>
        {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center">
      <Loader2 size={16} className="animate-spin" /> {label || 'Loading…'}
    </div>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-950/40 border border-red-900/60 text-sm text-red-200 mb-4">
      <AlertCircle size={16} className="shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && <button onClick={onRetry} className="underline hover:text-white">Try again</button>}
    </div>
  )
}

export function Empty({ icon: Icon, title, children }: { icon: any; title: string; children?: ReactNode }) {
  return (
    <div className="text-center py-16 px-6">
      <Icon size={40} className="mx-auto mb-4 text-slate-600" />
      <p className="text-base font-medium text-slate-200">{title}</p>
      {children && <div className="text-sm text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">{children}</div>}
    </div>
  )
}

export function Chip({ children, tone = 'slate', onRemove }: { children: ReactNode; tone?: 'slate' | 'green'; onRemove?: () => void }) {
  const c = tone === 'green' ? 'bg-emerald-900/40 text-emerald-300 border-emerald-800/60' : 'bg-slate-800 text-slate-300 border-slate-700'
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${c}`}>
      {children}
      {onRemove && (
        <button onClick={onRemove} className="hover:text-white -mr-0.5" title="Remove from this group"><X size={12} /></button>
      )}
    </span>
  )
}

// ── Toasts ─────────────────────────────────────────────────────────────────
export function useToasts() {
  const [items, setItems] = useState<{ id: number; msg: string; kind: 'ok' | 'error' }[]>([])
  const toast = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setItems(xs => [...xs, { id, msg, kind }])
    setTimeout(() => setItems(xs => xs.filter(x => x.id !== id)), kind === 'error' ? 6000 : 3000)
  }, [])
  const view = (
    <div className="fixed bottom-5 right-5 z-50 space-y-2">
      {items.map(t => (
        <div key={t.id} className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-2xl text-sm max-w-sm ${t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
          {t.kind === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />} {t.msg}
        </div>
      ))}
    </div>
  )
  return { toast, view }
}

// ── Text helpers ──────────────────────────────────────────────────────────────
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Same list as the search server: these words are ignored when searching.
const STOPWORDS = new Set(`a an and are as at be but by can could did do does for from had has have how i if in into is it its
me my of on or our so than that the their them then there these they this to was we were what when
where which who why will with would you your about tell decide decided discuss discussed said say much many
any some all get got just also very more most`.split(/\s+/))

/** Words worth highlighting from a search box entry. */
export function searchTerms(q: string): string[] {
  return [...new Set((q.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 1 && !STOPWORDS.has(w)))]
}

/** Markdown → plain text for one-line previews (search results). */
export function plainText(md: string): string {
  return md
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/\|?\s*:?-{3,}:?\s*(?=\||$)/gm, ' ')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)-{3,}(?=\s|$)/g, ' ')
    .replace(/\\([*_#|\\`-])/g, '$1')
    .replace(/(\s*·\s*){2,}/g, ' · ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .trim()
}

export function Highlight({ text, terms }: { text: string; terms?: string[] }) {
  if (!terms || terms.length === 0) return <>{text}</>
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.map(escapeRe).join('|')})`, 'giu')
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 && part ? <mark key={i} className="bg-amber-300/30 text-amber-100 rounded px-0.5">{part}</mark> : <Fragment key={i}>{part}</Fragment>
      )}
    </>
  )
}

// ── Tiny, safe Markdown renderer (no HTML injection) ────────────────────────
function inline(raw: string, terms?: string[], keyBase = ''): ReactNode[] {
  const text = raw.replace(/\\([*_#|`\\[\]()~>-])/g, '$1')
  // `code`, **bold**, *italic*, [label](https://…)
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|(?<![*\w])\*[^*\n]+\*(?!\*))/g
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<Highlight key={`${keyBase}t${i++}`} text={text.slice(last, m.index)} terms={terms} />)
    const tok = m[0]
    if (tok.startsWith('`')) {
      out.push(<code key={`${keyBase}c${i++}`} className="px-1 py-0.5 rounded bg-slate-800 text-emerald-200 text-[0.85em] font-mono">{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith('**')) {
      out.push(<strong key={`${keyBase}b${i++}`} className="font-semibold text-slate-50"><Highlight text={tok.slice(2, -2)} terms={terms} /></strong>)
    } else if (tok.startsWith('[')) {
      const lm = tok.match(/^\[([^\]]+)\]\((.+)\)$/)!
      out.push(<a key={`${keyBase}a${i++}`} href={lm[2]} target="_blank" rel="noreferrer" className="text-emerald-400 underline hover:text-emerald-300">{lm[1]}</a>)
    } else {
      out.push(<em key={`${keyBase}i${i++}`}><Highlight text={tok.slice(1, -1)} terms={terms} /></em>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(<Highlight key={`${keyBase}t${i++}`} text={text.slice(last)} terms={terms} />)
  return out
}

export function Markdown({ text, terms }: { text: string; terms?: string[] }) {
  const blocks: ReactNode[] = []
  const parts = text.split(/(```[\s\S]*?(?:```|$))/g)
  parts.forEach((part, pi) => {
    if (part.startsWith('```')) {
      const body = part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
      blocks.push(
        <pre key={`p${pi}`} className="my-3 p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto whitespace-pre">{body}</pre>
      )
      return
    }
    const lines = part.split('\n')
    let para: string[] = []
    let list: { ordered: boolean; items: string[] } | null = null
    const flushPara = () => {
      if (para.length) {
        blocks.push(<p key={`p${pi}-${blocks.length}`} className="my-2 leading-relaxed">{inline(para.join('\n'), terms, `p${pi}${blocks.length}`)}</p>)
        para = []
      }
    }
    const flushList = () => {
      if (list) {
        const Tag = list.ordered ? 'ol' : 'ul'
        blocks.push(
          <Tag key={`l${pi}-${blocks.length}`} className={`my-2 pl-6 space-y-1 ${list.ordered ? 'list-decimal' : 'list-disc'}`}>
            {list.items.map((it, j) => <li key={j} className="leading-relaxed">{inline(it, terms, `l${pi}${j}`)}</li>)}
          </Tag>
        )
        list = null
      }
    }
    const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
    const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim())
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li].replace(/\s+$/, '')
      let m: RegExpMatchArray | null
      if (!line.trim()) { flushPara(); flushList(); continue }
      if (isRow(line) && li + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[li + 1])) {
        flushPara(); flushList()
        const head = cells(line)
        const body: string[][] = []
        li += 2
        while (li < lines.length && isRow(lines[li])) body.push(cells(lines[li++]))
        li--
        const k = `tb${pi}-${blocks.length}`
        blocks.push(
          <div key={k} className="my-3 overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead><tr>{head.map((h, j) => <th key={j} className="border border-slate-700 bg-slate-800/70 px-2 py-1.5 text-left font-semibold text-slate-100">{inline(h, terms, `${k}h${j}`)}</th>)}</tr></thead>
              <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className="border border-slate-800 px-2 py-1.5 align-top">{inline(c, terms, `${k}${ri}-${j}`)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )
        continue
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushPara(); flushList(); blocks.push(<hr key={`h${pi}-${blocks.length}`} className="my-4 border-slate-700" />); continue }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushPara(); flushList()
        const size = m[1].length <= 2 ? 'text-lg' : 'text-base'
        blocks.push(<p key={`hd${pi}-${blocks.length}`} className={`${size} font-semibold text-slate-50 mt-4 mb-1`}>{inline(m[2], terms, `hd${pi}${blocks.length}`)}</p>)
        continue
      }
      if ((m = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/))) {
        flushPara()
        const ordered = !!m[1]
        if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } }
        list.items.push(m[2])
        continue
      }
      if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue }
      flushList()
      para.push(line)
    }
    flushPara(); flushList()
  })
  return <div className="text-sm text-slate-200">{blocks}</div>
}
