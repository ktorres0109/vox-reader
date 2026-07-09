// Vox Reader — background service worker

const CONTENT_FILES = ['content/content.js', 'content/tts_sync.js'];
const CONTENT_CSS = ['content/content.css'];

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.sync.remove(['currentWord', 'playerX', 'playerY']);
  if (details.reason === 'install') {
    chrome.storage.local.remove(['kokoroModelCached', 'kokoroCacheVersion']);
    chrome.storage.sync.set({
      voiceEngine: 'kokoro',
      kokoroVoice: 'af_bella',
    });
  }
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'vox-read-selection',
      title: 'Read selection with Vox Reader',
      contexts: ['selection'],
    });
  });
});

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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'vox-read-selection' || !tab?.id) return;
  const text = (info.selectionText || '').trim();
  if (!text) return;
  sendToTab(tab.id, { action: 'read_selection', text });
});

// ── Offscreen document management ──────────────────────────────────────────
let offscreenCreating = false;
let kokoroActiveTabId = null;

async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument().catch(() => false);
  if (exists) return;
  if (offscreenCreating) {
    await new Promise(r => setTimeout(r, 600));
    return;
  }
  offscreenCreating = true;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Kokoro 82M neural TTS synthesis and audio playback',
    });
  } finally {
    offscreenCreating = false;
  }
}

async function sendToOffscreen(msg, maxRetries = 12) {
  await ensureOffscreen();
  const fullMsg = { ...msg, target: 'offscreen' };
  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.runtime.sendMessage(fullMsg);
      return;
    } catch (_) {
      await new Promise(r => setTimeout(r, 400));
    }
  }
  if (msg.tabId) {
    chrome.tabs.sendMessage(msg.tabId, {
      action: 'kokoro_error',
      error: 'Offscreen document failed to initialize',
      tabId: msg.tabId,
    }).catch(() => {});
  }
}

async function kokoroVendorMissing() {
  try {
    const url = chrome.runtime.getURL('vendor/kokoro.web.js');
    const res = await fetch(url, { method: 'HEAD' });
    return !res.ok;
  } catch {
    return true;
  }
}

function notifyKokoroVendorMissing(tabId) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, {
    action: 'kokoro_error',
    error: 'Kokoro bundle missing — run: bash tools/fetch-deps.sh',
    tabId,
  }).catch(() => {});
}

function interruptKokoroTab(tabId) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, {
    action: 'kokoro_interrupted',
    tabId,
  }).catch(() => {});
}

async function routeKokoroAction(msg, tabId) {
  if (msg.action === 'kokoro_load' || msg.action === 'kokoro_speak') {
    const missing = await kokoroVendorMissing();
    if (missing) {
      notifyKokoroVendorMissing(tabId);
      return;
    }
  }

  if (msg.action === 'kokoro_speak' && tabId) {
    if (kokoroActiveTabId && kokoroActiveTabId !== tabId) {
      interruptKokoroTab(kokoroActiveTabId);
    }
    kokoroActiveTabId = tabId;
  }

  if (msg.action === 'kokoro_stop' && tabId && kokoroActiveTabId === tabId) {
    kokoroActiveTabId = null;
  }

  sendToOffscreen({ ...msg, tabId });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'kokoro_load' || msg.action === 'kokoro_speak' || msg.action === 'kokoro_stop' || msg.action === 'kokoro_warm_voice') {
    const tabId = sender.tab?.id;
    if (msg.action === 'kokoro_stop') {
      if (tabId && kokoroActiveTabId === tabId) kokoroActiveTabId = null;
      chrome.offscreen.hasDocument()
        .then(ex => { if (ex) sendToOffscreen({ ...msg, tabId }); })
        .catch(() => {});
      return;
    }
    if (msg.action === 'kokoro_load' || msg.action === 'kokoro_speak') {
      routeKokoroAction(msg, tabId);
      return;
    }
    sendToOffscreen({ ...msg, tabId });
    return;
  }

  if (
    msg.action === 'kokoro_ready'  ||
    msg.action === 'kokoro_progress' ||
    msg.action === 'kokoro_chunk'    || msg.action === 'kokoro_end'    ||
    msg.action === 'kokoro_error'
  ) {
    if (msg.action === 'kokoro_end' && msg.tabId && kokoroActiveTabId === msg.tabId) {
      kokoroActiveTabId = null;
    }
    if (msg.tabId) chrome.tabs.sendMessage(msg.tabId, msg).catch(() => {});
    return;
  }
});
