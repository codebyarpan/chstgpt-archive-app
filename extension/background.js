/**
 * ChatGPT Archive — background.js (service worker)
 * Relays requests from content.js / popup / options to the Archive API, which
 * runs either on this Mac (http://127.0.0.1:47821) or on a server.
 *
 * Pairing: when the desktop app copies this extension to
 * ~/ChatGPT Archive Extension it adds pairing.json with this Mac's token, so
 * nobody has to copy a token by hand. A token saved in the options page wins.
 */
'use strict';

const DEFAULT_SERVER = 'http://127.0.0.1:47821';

let pairing; // cached contents of pairing.json (null if absent)
async function readPairing() {
  if (pairing !== undefined) return pairing;
  try {
    const r = await fetch(chrome.runtime.getURL('pairing.json'));
    pairing = r.ok ? await r.json() : null;
  } catch {
    pairing = null;
  }
  return pairing;
}

/** Server URL + token: saved settings first, then pairing.json, then defaults. */
async function settings() {
  const d = await chrome.storage.local.get(['archiveServer', 'archivePort', 'archiveToken']);
  const p = (await readPairing()) || {};
  let server = (d.archiveServer || '').trim().replace(/\/+$/, '');
  if (!server) server = d.archivePort ? `http://127.0.0.1:${d.archivePort}` : (p.server || DEFAULT_SERVER);
  return { server, token: d.archiveToken || p.token || '' };
}

const isLocal = url => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url);

/** fetch → JSON, turning HTTP errors into messages a non-technical person can act on. */
async function api(path, { method = 'GET', body } = {}) {
  const { server, token } = await settings();
  let r;
  try {
    r = await fetch(server + path, {
      method,
      headers: {
        'X-Archive-Client': 'extension',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error(isLocal(server)
      ? 'The ChatGPT Archive app is not running. Open it on your Mac, then try again.'
      : `Can't reach the archive server at ${server}.`);
    e.code = 'OFFLINE';
    throw e;
  }
  let data = null;
  try { data = await r.json(); } catch { /* non-JSON body */ }
  if (!r.ok) {
    const detail = data && (data.detail || data.error);
    const e = new Error(r.status === 401
      ? 'This extension is not connected to your archive. In the ChatGPT Archive app, open Settings & help and set up Chrome again.'
      : `Something went wrong (${r.status}${typeof detail === 'string' ? `: ${detail}` : ''}).`);
    e.code = r.status === 401 ? 'UNAUTHORIZED' : 'HTTP';
    throw e;
  }
  return data;
}

const reply = (sendResponse, promise, shape) => {
  promise.then(d => sendResponse({ ok: true, ...shape(d) }))
         .catch(err => sendResponse({ ok: false, error: err.message || String(err), code: err.code || '' }));
  return true; // keep the channel open for the async response
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'OPEN_OPTIONS':
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return false;

    case 'GET_GROUPS':
      return reply(sendResponse, api('/groups'), groups => ({ groups }));

    case 'CREATE_GROUP':
      return reply(sendResponse, api('/groups', { method: 'POST', body: { name: message.name } }),
                   group => ({ group }));

    case 'KNOWN':
      return reply(sendResponse, api('/conversations/known', { method: 'POST', body: { ids: message.ids || [] } }),
                   known => ({ known }));

    case 'INGEST':
      return reply(sendResponse,
        api('/ingest', { method: 'POST', body: {
          conversations: message.conversations, group: message.group || null, projects: message.projects || {},
        } }),
        d => ({ ingested: d.ingested ?? 0, skipped: d.skipped ?? 0 }));

    case 'CHECK_HEALTH':
      return reply(sendResponse, api('/health'), d => ({ health: d }));

    default:
      sendResponse({ ok: false, error: 'Unknown message type' });
      return false;
  }
});
