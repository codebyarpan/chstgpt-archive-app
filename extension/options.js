'use strict';

const tokenEl = document.getElementById('token');
const serverEl = document.getElementById('server');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');
const healthEl = document.getElementById('health');

const isLocal = url => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url);
const send = msg => new Promise(res => chrome.runtime.sendMessage(msg, r => res(r || { ok: false, error: chrome.runtime.lastError?.message })));

chrome.storage.local.get(['archiveToken', 'archiveServer', 'archivePort'], data => {
  if (data.archiveToken) tokenEl.value = data.archiveToken;
  serverEl.value = data.archiveServer || (data.archivePort ? `http://127.0.0.1:${data.archivePort}` : '');
  checkHealth();
});

function note(text, cls) {
  statusEl.className = cls;
  statusEl.textContent = text;
}

saveBtn.addEventListener('click', async () => {
  const token = tokenEl.value.trim();
  let server = serverEl.value.trim().replace(/\/+$/, '');
  if (server) {
    let url;
    try { url = new URL(server); } catch { return note('That is not a valid address, e.g. https://archive.example.com', 'err'); }
    if (!/^https?:$/.test(url.protocol)) return note('The address must start with https:// (or http:// for this Mac)', 'err');
    server = url.origin;
    if (!isLocal(server)) {
      const granted = await chrome.permissions.request({ origins: [`${server}/*`] }).catch(() => false);
      if (!granted) return note(`Chrome did not allow reaching ${server}, so nothing was saved.`, 'err');
    }
  }
  serverEl.value = server;
  // Empty values are removed so the automatic pairing is used again.
  await chrome.storage.local.remove(['archivePort']);
  await (token ? chrome.storage.local.set({ archiveToken: token }) : chrome.storage.local.remove('archiveToken'));
  await (server ? chrome.storage.local.set({ archiveServer: server }) : chrome.storage.local.remove('archiveServer'));
  note('✓ Saved', 'ok');
  checkHealth();
});

async function checkHealth() {
  healthEl.textContent = 'Checking the connection…';
  healthEl.style.color = '';
  const g = await send({ type: 'GET_GROUPS' });
  if (!g.ok) {
    healthEl.textContent = '✗ ' + g.error;
    healthEl.style.color = '#b91c1c';
    return;
  }
  const h = await send({ type: 'CHECK_HEALTH' });
  healthEl.textContent = `✓ Connected. ${h.health?.conversations ?? 0} chats saved so far.`;
  healthEl.style.color = '#047857';
}
