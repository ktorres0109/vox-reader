const CONTENT_FILES = ['shared/core.js', 'content/content.js', 'content/tts_sync.js'];
const CONTENT_CSS = ['content/content.css'];

const PRIVACY_URL = 'https://ktorres0109.github.io/vox-reader/privacy.html';

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function injectContent(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  await chrome.scripting.insertCSS({ target: { tabId }, files: CONTENT_CSS });
}

async function sendToTab(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch (_) {
    await injectContent(tabId);
    await chrome.tabs.sendMessage(tabId, msg);
  }
}

async function getPageSelection(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (window.getSelection()?.toString() || '').trim(),
    });
    const selected = (results || []).filter((result) => result.result);
    return (selected.find((result) => result.frameId === 0) || selected[0])?.result || '';
  } catch (_) {
    return '';
  }
}

function setButtonError(btn, message) {
  btn.textContent = message;
  btn.style.background = '#555';
  btn.disabled = true;
}

chrome.commands.getAll((commands) => {
  const shortcuts = new Map(commands.map((command) => [command.name, command.shortcut || 'Not set']));
  document.getElementById('sc-play-display').textContent = shortcuts.get('toggle-player') || 'Not set';
  document.getElementById('sc-stop-display').textContent = shortcuts.get('stop-reading') || 'Not set';
  document.getElementById('sc-read-display').textContent = shortcuts.get('read-selection') || 'Not set';
  document.getElementById('sc-export-display').textContent = shortcuts.get('export-audio') || 'Not set';
});

const manifest = chrome.runtime.getManifest();
const versionEl = document.getElementById('popup-version');
if (versionEl) versionEl.textContent = `v${manifest.version}`;

document.getElementById('privacy-link')?.addEventListener('click', () => {
  chrome.tabs.create({ url: PRIVACY_URL });
});

document.getElementById('open-player').addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  const btn = document.getElementById('open-player');
  try {
    await sendToTab(tab.id, { action: 'toggle_player' });
    window.close();
  } catch (_) {
    setButtonError(btn, 'Cannot run on this page');
  }
});

document.getElementById('read-selection').addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  const btn = document.getElementById('read-selection');
  const text = await getPageSelection(tab.id);
  if (!text) {
    btn.textContent = 'Select text on the page first';
    btn.classList.add('hint');
    return;
  }
  try {
    await sendToTab(tab.id, { action: 'read_selection', text });
    window.close();
  } catch (_) {
    setButtonError(btn, 'Cannot run on this page');
  }
});

(async () => {
  const tab = await getActiveTab();
  const readBtn = document.getElementById('read-selection');
  if (!tab?.id) return;
  const text = await getPageSelection(tab.id);
  if (text) {
    readBtn.classList.add('has-selection');
    readBtn.title = `Read ${Math.min(text.length, 40)}${text.length > 40 ? '…' : ''} chars`;
  } else {
    readBtn.title = 'Highlight text on the page, then click';
  }
})();
