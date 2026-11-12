// Vox Reader — background service worker

importScripts('download.js');

const CONTENT_FILES = [
  'content/lib/text-clean.js',
  'content/lib/positions.js',
  'content/lib/playback-math.js',
  'content/player-styles.js',
  'content/player.js',
  'content/content.js',
];
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

async function getTabSelection(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (window.getSelection()?.toString() || '').trim(),
    });
    return (results || []).map((r) => r.result).filter(Boolean).join('\n').trim();
  } catch (_) {
    return '';
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const tabId = tab.id;

  if (command === 'toggle-player') {
    await sendToTab(tabId, { action: 'command_play_pause' });
    return;
  }
  if (command === 'stop-reading') {
    await sendToTab(tabId, { action: 'command_stop' });
    return;
  }
  if (command === 'read-selection') {
    const text = await getTabSelection(tabId);
    if (!text) return;
    await sendToTab(tabId, { action: 'read_selection', text });
    return;
  }
  if (command === 'export-audio') {
    await sendToTab(tabId, { action: 'command_export' });
  }
});

// ── Offscreen document management ──────────────────────────────────────────
let offscreenCreating = false;
// Cached in-memory; persisted to storage.session so it survives SW restarts
let kokoroActiveTabId = null;

async function getKokoroActiveTab() {
  if (kokoroActiveTabId) return kokoroActiveTabId;
  try {
    const r = await chrome.storage.session.get('kokoroActiveTabId');
    kokoroActiveTabId = r.kokoroActiveTabId || null;
  } catch (_) {}
  return kokoroActiveTabId;
}

function setKokoroActiveTab(tabId) {
  kokoroActiveTabId = tabId;
  chrome.storage.session.set({ kokoroActiveTabId: tabId }).catch(() => {});
}

function clearKokoroActiveTab() {
  kokoroActiveTabId = null;
  chrome.storage.session.remove('kokoroActiveTabId').catch(() => {});
}

async function ensureOffscreen() {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await chrome.offscreen.hasDocument().catch(() => false)) return;

    if (offscreenCreating) {
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 300));
        if (await chrome.offscreen.hasDocument().catch(() => false)) return;
      }
      // Creator may have failed — loop around and try creating ourselves
      continue;
    }

    offscreenCreating = true;
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen/offscreen.html',
        // AUDIO_PLAYBACK alone lets Chrome close the doc after ~30 s without
        // audible output (first model download, long pauses), dropping the
        // loaded model mid-read. BLOBS (synthesized audio buffers, MP3/WAV
        // export) has no such timer. Verified in Brave 1.99: with AUDIO_PLAYBACK
        // alone the doc was closed ~17 s into a pause; with BLOBS it survives.
        reasons: ['AUDIO_PLAYBACK', 'BLOBS'],
        justification: 'Kokoro 82M neural TTS: synthesizes audio buffers on device, plays them, and encodes MP3/WAV exports',
      }).catch(() => { /* lost a create race — poll below */ });
      for (let i = 0; i < 25; i++) {
        if (await chrome.offscreen.hasDocument().catch(() => false)) return;
        await new Promise(r => setTimeout(r, 300));
      }
    } finally {
      offscreenCreating = false;
    }
  }
}

// Generous retry window: a freshly created doc parses the 2 MB kokoro bundle,
// and a busy one may be mid-synthesis on its only thread.
async function sendToOffscreen(msg, maxRetries = 30) {
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
  if (msg.action === 'kokoro_load' || msg.action === 'kokoro_speak' || msg.action === 'kokoro_export') {
    const missing = await kokoroVendorMissing();
    if (missing) {
      notifyKokoroVendorMissing(tabId);
      return;
    }
  }

  if (msg.action === 'kokoro_export') {
    const activeTab = await getKokoroActiveTab();
    if (activeTab) {
      if (activeTab !== tabId) interruptKokoroTab(activeTab);
      clearKokoroActiveTab();
    }
    await sendToOffscreen({ action: 'kokoro_stop', tabId });
    sendToOffscreen({ ...msg, tabId });
    return;
  }

  if (msg.action === 'kokoro_speak' && tabId) {
    const activeTab = await getKokoroActiveTab();
    if (activeTab && activeTab !== tabId) {
      interruptKokoroTab(activeTab);
    }
    setKokoroActiveTab(tabId);
  }

  if (msg.action === 'kokoro_stop' && tabId) {
    const activeTab = await getKokoroActiveTab();
    if (activeTab === tabId) clearKokoroActiveTab();
  }

  sendToOffscreen({ ...msg, tabId });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'kokoro_load' || msg.action === 'kokoro_speak' || msg.action === 'kokoro_stop' || msg.action === 'kokoro_pause' || msg.action === 'kokoro_resume' || msg.action === 'kokoro_warm_voice' || msg.action === 'kokoro_export' || msg.action === 'kokoro_export_cancel' || msg.action === 'kokoro_load_cancel' || msg.action === 'kokoro_debug_state') {
    const tabId = sender.tab?.id;
    if (msg.action === 'kokoro_stop' || msg.action === 'kokoro_pause' || msg.action === 'kokoro_resume' || msg.action === 'kokoro_load_cancel') {
      if (msg.action === 'kokoro_stop' && tabId) {
        getKokoroActiveTab().then((activeTab) => {
          if (activeTab === tabId) clearKokoroActiveTab();
        });
      }
      chrome.offscreen.hasDocument()
        .then((ex) => {
          if (ex) sendToOffscreen({ ...msg, tabId });
          // The offscreen doc can be closed during a long pause; the tab restarts.
          else if (msg.action === 'kokoro_resume' && tabId) {
            chrome.tabs.sendMessage(tabId, { action: 'kokoro_resume_failed', tabId }).catch(() => {});
          }
        })
        .catch(() => {});
      return;
    }
    if (msg.action === 'kokoro_export_cancel') {
      sendToOffscreen({ ...msg, tabId });
      return;
    }
    if (msg.action === 'kokoro_load' || msg.action === 'kokoro_speak' || msg.action === 'kokoro_export') {
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
    msg.action === 'kokoro_error'    ||
    msg.action === 'kokoro_load_cancelled' ||
    msg.action === 'kokoro_export_progress' ||
    msg.action === 'kokoro_export_error' ||
    msg.action === 'kokoro_media' ||
    msg.action === 'kokoro_resume_failed' ||
    msg.action === 'kokoro_debug_state_result'
  ) {
    if (msg.action === 'kokoro_end' && msg.tabId) {
      getKokoroActiveTab().then((activeTab) => {
        if (activeTab === msg.tabId) clearKokoroActiveTab();
      });
    }
    if (msg.tabId) chrome.tabs.sendMessage(msg.tabId, msg).catch(() => {});
    return;
  }

  if (msg.action === 'kokoro_export_ready') {
    const filename = msg.filename || 'vox-reader-export.wav';
    const tabId = msg.tabId;
    const mimeType = msg.mimeType || 'audio/wav';
    const audioB64 = msg.audioBase64 || msg.wavBase64;
    try {
      const bytes = base64ToUint8Array(audioB64);
      downloadAudioBlob(bytes, filename, mimeType)
        .then(() => {
          if (tabId) {
            chrome.tabs.sendMessage(tabId, { action: 'kokoro_export_done', filename, tabId }).catch(() => {});
          }
        })
        .catch((err) => {
          if (tabId) {
            chrome.tabs.sendMessage(tabId, {
              action: 'kokoro_export_error',
              error: err.message,
              tabId,
            }).catch(() => {});
          }
        });
    } catch (err) {
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          action: 'kokoro_export_error',
          error: err.message,
          tabId,
        }).catch(() => {});
      }
    }
    return;
  }
});

// The offscreen doc holds a port open; if it disconnects while this SW is
// alive, the document was closed by the browser (not an SW restart).
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'vox-offscreen') return;
  port.onDisconnect.addListener(async () => {
    const tabId = await getKokoroActiveTab();
    if (tabId) chrome.tabs.sendMessage(tabId, { action: 'kokoro_offscreen_lost', tabId }).catch(() => {});
  });
});

// ── External API (other extensions, e.g. Focus Reader) ─────────────────────
// No "externally_connectable" key in the manifest = any installed extension may
// message Vox (web pages may not). Messages:
//   { action: 'vox_ping' }                         -> { ok: true, version }
//   { action: 'vox_read', text, title?, tabId? }   -> { ok: true, tabId } | { ok: false, error }
// vox_read opens the normal player in the target tab (msg.tabId, else the
// sender's tab, else the active tab) and reads `text`, highlighting it on the
// page when it can be found there.
const EXTERNAL_TEXT_LIMIT = 200000;

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.action === 'vox_ping') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return;
  }
  if (msg.action !== 'vox_read') return;
  const text = typeof msg.text === 'string' ? msg.text.slice(0, EXTERNAL_TEXT_LIMIT).trim() : '';
  if (!text) {
    sendResponse({ ok: false, error: 'text is required' });
    return;
  }
  const title = typeof msg.title === 'string' ? msg.title.slice(0, 300) : '';
  (async () => {
    let tabId = Number.isInteger(msg.tabId) ? msg.tabId : sender.tab?.id;
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tabId = tab?.id;
    }
    if (!tabId) throw new Error('no target tab');
    await sendToTab(tabId, { action: 'vox_read_text', text, title, from: sender.id || '' });
    return tabId;
  })()
    .then((tabId) => sendResponse({ ok: true, tabId }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
