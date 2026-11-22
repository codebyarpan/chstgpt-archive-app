/**
 * ChatGPT Archive — content.js (v5)
 * A green button on chatgpt.com opens a panel: find chats, tick them, Save.
 *
 * The chat list comes from ChatGPT's own API (the same one its sidebar uses),
 * so every chat is listed, including chats inside projects; if that API
 * fails, the links in the sidebar are used instead. Content-script fetches to
 * chatgpt.com are same-origin and carry the user's cookies.
 * The panel lives in a Shadow DOM so ChatGPT's styles cannot affect it.
 */
'use strict';

const HOST_ID = '__cga_host__';
const SAVE_BATCH = 10;       // chats per request to the archive
const MAX_LIST = 5000;       // safety cap on the chat list
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sendMsg(msg) {
  return new Promise((res) => chrome.runtime.sendMessage(msg, r => {
    if (chrome.runtime.lastError) {
      // The extension was reloaded/updated while this page stayed open.
      return res({ ok: false, error: 'The extension was updated. Please reload this page.', code: 'STALE' });
    }
    res(r || { ok: false, error: 'No answer from the extension' });
  }));
}

// ── ChatGPT backend access ────────────────────────────────────────────────────
let _session = null; // { token, exp }
async function getAccessToken(force = false) {
  if (!force && _session && _session.exp > Date.now()) return _session.token;
  const r = await fetch('/api/auth/session', { credentials: 'include' });
  if (!r.ok) throw new Error(`could not check your ChatGPT login (HTTP ${r.status})`);
  const s = await r.json();
  if (!s || !s.accessToken) throw new Error('you are not logged in to ChatGPT');
  _session = { token: s.accessToken, exp: Date.now() + 5 * 60 * 1000 };
  return s.accessToken;
}
function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
async function backend(path, attempt = 0) {
  const token = await getAccessToken(attempt === 1);
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
  const account = getCookie('_account'); // Team/Enterprise workspaces
  if (account) headers['ChatGPT-Account-Id'] = account;
  const r = await fetch(path, { credentials: 'include', headers });
  if (r.status === 401 && attempt === 0) return backend(path, 1);   // token expired: refresh once
  if (r.status === 429 && attempt < 5) {                            // rate limited: back off
    const retryAfter = parseFloat(r.headers.get('Retry-After')) || 0;
    await sleep(Math.max(retryAfter * 1000, 2000 * 2 ** attempt));
    return backend(path, attempt + 1);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fetchConv(id) {
  const data = await backend(`/backend-api/conversation/${id}`);
  if (!data || typeof data.mapping !== 'object') throw new Error('unexpected response from ChatGPT');
  if (!data.id) data.id = data.conversation_id || id;
  return data;
}
const toMs = t => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : (Date.parse(t || '') || 0));

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  chats: new Map(),   // id -> {id, title, updated(ms), project}
  projects: {},       // gizmo id -> project name
  known: {},          // id -> update_time (s) of the saved copy
  selected: new Set(),
  filter: '',
  listing: false,
  listError: '',
  appError: '',       // archive app not reachable / not paired
  appErrorCode: '',   // 'STALE' = extension updated: only a page reload helps
  groups: [],
  group: '',
  busy: '',           // progress text while saving
};

function addChats(items, projectName) {
  for (const it of items || []) {
    if (!it || !it.id) continue;
    const prev = state.chats.get(it.id);
    state.chats.set(it.id, {
      id: it.id,
      title: (it.title || prev?.title || 'Untitled chat').trim(),
      updated: toMs(it.update_time || it.create_time) || prev?.updated || 0,
      project: projectName || prev?.project || '',
    });
  }
}

/** Fallback: chat links currently in the sidebar. */
function scrapeSidebar() {
  const items = [];
  document.querySelectorAll('a[href*="/c/"]').forEach(a => {
    const m = (a.getAttribute('href') || '').match(/\/c\/([0-9a-f-]{30,})/);
    if (m) items.push({ id: m[1], title: (a.innerText || a.textContent || '').trim().split('\n')[0] });
  });
  return items;
}
/** {gizmo_id: name} from project links in the sidebar. */
function scrapeProjects() {
  const out = {};
  document.querySelectorAll('a[href*="/g/g-p-"]').forEach(a => {
    const m = (a.getAttribute('href') || '').match(/\/g\/(g-p-[0-9a-f]{32})(?:-[^/]*)?\/project\b/);
    const name = (a.innerText || a.textContent || '').trim().split('\n')[0].trim();
    if (m && name) out[m[1]] = name;
  });
  return out;
}

async function loadChatList() {
  if (state.listing) return;
  state.listing = true; state.listError = '';
  render();
  try {
    // 1. Main list, newest first.
    for (let offset = 0; offset < MAX_LIST; offset += 100) {
      const d = await backend(`/backend-api/conversations?offset=${offset}&limit=100&order=updated`);
      const items = d.items || [];
      addChats(items, '');
      render();
      if (items.length < 100 || (d.total != null && offset + 100 >= d.total)) break;
    }
  } catch (e) {
    addChats(scrapeSidebar(), '');
    if (!state.chats.size) state.listError = `Could not load your chat list (${e.message}). Reload the page and try again.`;
  }
  // 2. Projects and the chats inside them (optional: older accounts have none).
  try {
    let cursor = null, guard = 0;
    do {
      const d = await backend(`/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0${cursor != null ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      for (const it of d.items || []) {
        const g = it && it.gizmo && it.gizmo.gizmo;
        if (g && /^g-p-/.test(g.id || '')) state.projects[g.id] = (g.display && g.display.name) || 'Project';
      }
      cursor = d.cursor ?? null;
    } while (cursor != null && ++guard < 50);
    for (const [gid, name] of Object.entries(state.projects)) {
      let c = '0', guard2 = 0;
      do {
        const d = await backend(`/backend-api/gizmos/${gid}/conversations?cursor=${encodeURIComponent(c)}&limit=50`);
        addChats(d.items, name);
        render();
        c = d.cursor ?? null;
      } while (c != null && ++guard2 < 100);
    }
  } catch { /* projects are optional */ }
  Object.assign(state.projects, scrapeProjects());
  state.listing = false;
  await refreshKnown();
  render();
}

async function refreshKnown() {
  if (!state.chats.size) return;
  const res = await sendMsg({ type: 'KNOWN', ids: [...state.chats.keys()] });
  if (res.ok) { state.known = res.known || {}; state.appError = ''; }
  else { state.appError = res.error; state.appErrorCode = res.code || ''; }
}

async function loadGroups() {
  const res = await sendMsg({ type: 'GET_GROUPS' });
  if (res.ok) { state.groups = res.groups || []; state.appError = ''; }
  else { state.appError = res.error; state.appErrorCode = res.code || ''; }
  render();
}

function chatStatus(c) {
  const saved = state.known[c.id];
  if (saved === undefined) return 'new';
  return c.updated && c.updated / 1000 > saved + 2 ? 'changed' : 'saved';
}

// ── Saving ────────────────────────────────────────────────────────────────────
async function save(ids) {
  if (!ids.length || state.busy) return;
  const errors = [];
  let saved = 0;
  try {
    for (let i = 0; i < ids.length; i += SAVE_BATCH) {
      const part = ids.slice(i, i + SAVE_BATCH);
      const convs = [];
      for (let j = 0; j < part.length; j++) {
        state.busy = `Saving ${Math.min(i + j + 1, ids.length)} of ${ids.length}…`;
        render();
        try { convs.push(await fetchConv(part[j])); } catch (e) { errors.push(e.message); }
        await sleep(250); // be gentle with ChatGPT's rate limit
      }
      if (!convs.length) continue;
      const res = await sendMsg({
        type: 'INGEST', conversations: convs, group: state.group || null,
        projects: { ...state.projects, ...scrapeProjects() },
      });
      if (!res.ok) throw new Error(res.error);
      saved += convs.length;
    }
    if (saved === 0) {
      toast(`Could not save: ${errors[0] || 'unknown error'}`, true);
    } else {
      let msg = `Saved ${saved} chat${saved === 1 ? '' : 's'}${state.group ? ` to "${state.group}"` : ''} ✓`;
      if (errors.length) msg += ` · ${errors.length} could not be saved (${errors[0]})`;
      toast(msg, errors.length > 0);
      ids.forEach(id => state.selected.delete(id));
    }
  } catch (e) {
    toast(e.message, true);
  } finally {
    state.busy = '';
    await refreshKnown();
    loadGroups();
  }
}

// ── UI ────────────────────────────────────────────────────────────────────────
const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
.fab { position: fixed; bottom: 18px; right: 18px; z-index: 2147483647; width: 46px; height: 46px; border-radius: 50%;
  background: #059669; border: none; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; transition: transform .15s, background .15s; }
.fab:hover { background: #047857; transform: scale(1.06); }
.fab svg { width: 22px; height: 22px; }
.panel { position: fixed; bottom: 74px; right: 18px; z-index: 2147483647; width: 360px; max-height: min(620px, calc(100vh - 100px));
  background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 16px; box-shadow: 0 16px 48px rgba(0,0,0,.5);
  display: flex; flex-direction: column; font-size: 13px; overflow: hidden; }
.hd { padding: 14px 16px 10px; border-bottom: 1px solid #1e293b; }
.title { display: flex; align-items: center; justify-content: space-between; font-weight: 700; font-size: 15px; color: #f8fafc; }
.x { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 20px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.x:hover { background: #1e293b; color: #fff; }
.sub { color: #94a3b8; font-size: 12px; margin-top: 3px; }
.alert { margin: 10px 16px 0; padding: 10px 12px; border-radius: 10px; background: #451a1a; color: #fecaca; font-size: 12px; line-height: 1.45; }
.alert button { margin-top: 6px; }
.current { margin: 10px 16px 0; padding: 10px 12px; border-radius: 10px; background: #064e3b; display: flex; align-items: center; gap: 8px; }
.current span { flex: 1; font-size: 12px; color: #d1fae5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
input.search { width: 100%; margin-top: 10px; padding: 8px 10px; border-radius: 8px; border: 1px solid #334155; background: #020617; color: #f1f5f9; font-size: 13px; outline: none; }
input.search:focus { border-color: #10b981; }
.quick { display: flex; gap: 6px; margin-top: 8px; align-items: center; color: #94a3b8; font-size: 12px; }
.link { background: none; border: none; color: #34d399; cursor: pointer; font-size: 12px; padding: 2px 4px; border-radius: 4px; }
.link:hover { background: #1e293b; }
.list { overflow-y: auto; flex: 1; padding: 4px 6px; min-height: 120px; }
.row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 8px; cursor: pointer; }
.row:hover { background: #1e293b; }
.row input { accent-color: #059669; width: 15px; height: 15px; flex-shrink: 0; cursor: pointer; }
.row .t { color: #e2e8f0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .m { color: #64748b; font-size: 11px; margin-top: 1px; }
.row .info { min-width: 0; flex: 1; }
.badge { font-size: 10px; padding: 1px 6px; border-radius: 99px; margin-left: 4px; }
.b-saved { background: #064e3b; color: #6ee7b7; }
.b-changed { background: #422006; color: #fcd34d; }
.note { padding: 18px 12px; color: #94a3b8; font-size: 12px; text-align: center; line-height: 1.5; }
.ft { padding: 12px 16px 14px; border-top: 1px solid #1e293b; }
.ft label { display: block; color: #94a3b8; font-size: 12px; margin-bottom: 5px; }
select { width: 100%; padding: 7px 8px; border-radius: 8px; border: 1px solid #334155; background: #020617; color: #f1f5f9; font-size: 13px; margin-bottom: 10px; }
.btn { width: 100%; border: none; border-radius: 10px; padding: 10px; font-size: 14px; font-weight: 700; cursor: pointer; background: #059669; color: #fff; }
.btn:hover:not(:disabled) { background: #047857; }
.btn:disabled { opacity: .45; cursor: default; }
.btn.small { width: auto; padding: 6px 12px; font-size: 12px; border-radius: 8px; }
.toast { position: fixed; bottom: 74px; right: 18px; z-index: 2147483647; max-width: 340px; padding: 11px 14px; border-radius: 10px; color: #fff;
  font-size: 13px; line-height: 1.4; box-shadow: 0 6px 20px rgba(0,0,0,.4); transition: opacity .4s; }
`;
const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>';

let root, panel, open = false;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = ms => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const currentChatId = () => (location.pathname.match(/\/c\/([0-9a-f-]{30,})/) || [])[1];

function toast(msg, err = false) {
  root.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.background = err ? '#dc2626' : '#059669';
  el.textContent = msg;
  if (open) el.style.bottom = '20px', el.style.right = '390px';
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, err ? 7000 : 4000);
}

function visibleChats() {
  const f = state.filter.trim().toLowerCase();
  return [...state.chats.values()]
    .filter(c => !f || c.title.toLowerCase().includes(f) || c.project.toLowerCase().includes(f))
    .sort((a, b) => b.updated - a.updated);
}

function render() {
  if (!panel) return;
  panel.style.display = open ? 'flex' : 'none';
  if (!open) return;
  const chats = visibleChats();
  const cur = currentChatId();
  const curChat = cur && (state.chats.get(cur) || { id: cur, title: document.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, '') || 'This chat' });
  const curStatus = curChat ? chatStatus(curChat) : '';
  const n = state.selected.size;

  // Keep focus/caret in the search box across re-renders.
  const hadFocus = root.activeElement && root.activeElement.classList.contains('search');
  const caret = hadFocus ? root.activeElement.selectionStart : null;
  const scrollTop = panel.querySelector('.list')?.scrollTop || 0;

  panel.innerHTML = `
    <div class="hd">
      <div class="title"><span>Save to ChatGPT Archive</span><button class="x" data-act="close" title="Close">×</button></div>
      <div class="sub">Tick the chats you want to keep, then press Save.</div>
      <input class="search" placeholder="Find a chat by title…" value="${esc(state.filter)}" />
      <div class="quick">Select:
        <button class="link" data-act="sel-new">not saved yet</button>
        <button class="link" data-act="sel-all">all shown</button>
        <button class="link" data-act="sel-none">none</button>
      </div>
    </div>
    ${state.appError ? `<div class="alert">${esc(state.appError)}<br>${state.appErrorCode === 'STALE' ? '<button class="btn small" data-act="reload">Reload page</button>' : '<button class="btn small" data-act="retry">Try again</button>'}</div>` : ''}
    ${curChat && !state.appError ? `<div class="current"><span>This chat: ${esc(curChat.title)}${curStatus === 'saved' ? ' (saved ✓)' : ''}</span>
      <button class="btn small" data-act="save-current" ${state.busy ? 'disabled' : ''}>${curStatus === 'saved' ? 'Save again' : 'Save it'}</button></div>` : ''}
    <div class="list">
      ${state.listError ? `<div class="note">${esc(state.listError)}</div>` : ''}
      ${!state.listError && chats.length === 0 ? `<div class="note">${state.listing ? 'Loading your chats…' : state.filter ? 'No chat titles match.' : 'No chats found.'}</div>` : ''}
      ${chats.slice(0, 1500).map(c => {
        const st = chatStatus(c);
        const badge = st === 'saved' ? '<span class="badge b-saved">saved</span>' : st === 'changed' ? '<span class="badge b-changed">changed since saved</span>' : '';
        return `<label class="row"><input type="checkbox" data-id="${esc(c.id)}" ${state.selected.has(c.id) ? 'checked' : ''}/>
          <div class="info"><div class="t">${esc(c.title)}</div><div class="m">${esc([c.project, fmtDate(c.updated)].filter(Boolean).join(' · '))}${badge}</div></div></label>`;
      }).join('')}
      ${state.listing && chats.length ? '<div class="note">Loading more chats…</div>' : ''}
    </div>
    <div class="ft">
      <label>Put them in a group (optional)</label>
      <select class="group">
        <option value="">No group</option>
        ${state.groups.map(g => `<option value="${esc(g.name)}" ${g.name === state.group ? 'selected' : ''}>${esc(g.name)} (${g.count ?? 0})</option>`).join('')}
        <option value="__new__">+ New group…</option>
      </select>
      <button class="btn" data-act="save" ${!n || state.busy || state.appError ? 'disabled' : ''}>
        ${state.busy ? esc(state.busy) : n ? `Save ${n} chat${n === 1 ? '' : 's'}` : 'Save'}
      </button>
    </div>`;

  const list = panel.querySelector('.list');
  list.scrollTop = scrollTop;
  const search = panel.querySelector('.search');
  if (hadFocus) { search.focus(); search.setSelectionRange(caret, caret); }
}

function onPanelEvent(e) {
  const t = e.target;
  if (e.type === 'input' && t.classList.contains('search')) {
    state.filter = t.value; render(); return;
  }
  if (e.type === 'change' && t.matches('input[type=checkbox][data-id]')) {
    t.checked ? state.selected.add(t.dataset.id) : state.selected.delete(t.dataset.id);
    render(); return;
  }
  if (e.type === 'change' && t.classList.contains('group')) {
    if (t.value === '__new__') {
      const name = (prompt('Name for the new group:') || '').trim();
      if (!name) { render(); return; }
      sendMsg({ type: 'CREATE_GROUP', name }).then(res => {
        if (!res.ok) { toast(res.error, true); render(); return; }
        state.group = name;
        loadGroups();
      });
    } else {
      state.group = t.value;
    }
    return;
  }
  if (e.type !== 'click') return;
  const act = t.closest('[data-act]')?.dataset.act;
  switch (act) {
    case 'close': setOpen(false); break;
    case 'sel-all': visibleChats().forEach(c => state.selected.add(c.id)); render(); break;
    case 'sel-new': visibleChats().filter(c => chatStatus(c) !== 'saved').forEach(c => state.selected.add(c.id)); render(); break;
    case 'sel-none': state.selected.clear(); render(); break;
    case 'save': save([...state.selected]); break;
    case 'save-current': save([currentChatId()]); break;
    case 'reload': location.reload(); break;
    case 'retry': state.appError = ''; loadGroups().then(refreshKnown).then(render); break;
  }
}

function setOpen(v) {
  open = v;
  render();
  if (open) {
    loadGroups();
    if (!state.chats.size && !state.listing) loadChatList();
    else refreshKnown().then(render);
    setTimeout(() => panel.querySelector('.search')?.focus(), 50);
  }
}

function build() {
  if (document.getElementById(HOST_ID)) return;
  const host = document.createElement('div');
  host.id = HOST_ID;
  root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style><button class="fab" title="Save chats to ChatGPT Archive">${ICON}</button><div class="panel" style="display:none"></div>`;
  panel = root.querySelector('.panel');
  root.querySelector('.fab').addEventListener('click', e => { e.stopPropagation(); setOpen(!open); });
  ['click', 'change', 'input'].forEach(type => panel.addEventListener(type, onPanelEvent));
  // Keys typed in the panel must not reach ChatGPT's own shortcuts.
  panel.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') setOpen(false); });
  document.body.appendChild(host);
}

// Close when clicking elsewhere on the page.
document.addEventListener('click', e => {
  const host = document.getElementById(HOST_ID);
  if (open && host && !e.composedPath().includes(host)) setOpen(false);
}, true);

// Re-render when ChatGPT navigates to another chat (it's a single-page app).
let lastPath = location.pathname;
setInterval(() => { if (location.pathname !== lastPath) { lastPath = location.pathname; if (open) render(); } }, 800);

build();
// Re-add the button if ChatGPT ever wipes it from <body>.
new MutationObserver(() => { if (!document.getElementById(HOST_ID)) { panel = null; build(); } })
  .observe(document.body, { childList: true });
