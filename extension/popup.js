'use strict';

const statusEl = document.getElementById('status');
document.getElementById('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('go').addEventListener('click', () => { chrome.tabs.create({ url: 'https://chatgpt.com/' }); window.close(); });

chrome.runtime.sendMessage({ type: 'GET_GROUPS' }, res => {
  if (res && res.ok) {
    statusEl.textContent = '✓ Connected to the ChatGPT Archive app';
    statusEl.style.color = '#047857';
  } else {
    statusEl.textContent = (res && res.error) || 'The ChatGPT Archive app is not running. Open it on your Mac.';
    statusEl.style.color = '#b91c1c';
  }
});
