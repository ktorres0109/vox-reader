const CONTENT_FILES = ['content/content.js', 'content/tts_sync.js'];
const CONTENT_CSS = ['content/content.css'];

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
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.getSelection()?.toString() || '').trim(),
    });
    return result || '';
  } catch (_) {
    return '';
  }
}

function setButtonError(btn, message) {
  btn.textContent = message;
  btn.style.background = '#555';
  btn.disabled = true;
}

chrome.storage.sync.get('shortcuts', (p) => {
  const sc = p.shortcuts || {};
  document.getElementById('sc-play-display').textContent = `Alt+${(sc.play || 'p').toUpperCase()}`;
  document.getElementById('sc-stop-display').textContent = `Alt+${(sc.stop || 's').toUpperCase()}`;
  document.getElementById('sc-read-display').textContent = `Alt+${(sc.read || 'r').toUpperCase()}`;
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
