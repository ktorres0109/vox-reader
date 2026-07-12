// Vox Reader — background service worker

importScripts('download.js');

const CONTENT_FILES = ['shared/core.js', 'content/content.js', 'content/tts_sync.js'];
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
    const selected = (results || []).filter((result) => result.result);
    return (selected.find((result) => result.frameId === 0) || selected[0])?.result || '';
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
let kokoroActivePlaybackId = null;
let kokoroActiveTabLoaded = false;
let kokoroActiveTabChain = Promise.resolve();
let kokoroActionChain = Promise.resolve();

async function getKokoroActiveTab() {
  if (kokoroActiveTabLoaded) return kokoroActiveTabId;
  try {
    const r = await chrome.storage.session.get(['kokoroActiveTabId', 'kokoroActivePlaybackId']);
    kokoroActiveTabId = r.kokoroActiveTabId || null;
    kokoroActivePlaybackId = r.kokoroActivePlaybackId ?? null;
  } catch (_) {}
  kokoroActiveTabLoaded = true;
  return kokoroActiveTabId;
}

async function setKokoroActiveTab(tabId, playbackId) {
  kokoroActiveTabId = tabId;
  kokoroActivePlaybackId = playbackId ?? null;
  kokoroActiveTabLoaded = true;
  await chrome.storage.session.set({
    kokoroActiveTabId: tabId,
    kokoroActivePlaybackId: kokoroActivePlaybackId,
  }).catch(() => {});
}

async function clearKokoroActiveTab(expectedTabId = null, expectedPlaybackId = null) {
  if (expectedTabId != null && kokoroActiveTabId !== expectedTabId) return false;
  if (expectedPlaybackId != null && kokoroActivePlaybackId !== expectedPlaybackId) return false;
  kokoroActiveTabId = null;
  kokoroActivePlaybackId = null;
  kokoroActiveTabLoaded = true;
  await chrome.storage.session.remove([
    'kokoroActiveTabId',
    'kokoroActivePlaybackId',
  ]).catch(() => {});
  return true;
}

function withKokoroActiveTab(fn) {
  const run = kokoroActiveTabChain.then(async () => {
    await getKokoroActiveTab();
    return fn();
  });
  kokoroActiveTabChain = run.catch(() => {});
  return run;
}

function enqueueKokoroAction(fn) {
  const run = kokoroActionChain.then(fn);
  kokoroActionChain = run.catch(() => {});
  return run;
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
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Kokoro 82M neural TTS synthesis and audio playback',
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
  if (msg.action === 'kokoro_load' || msg.action === 'kokoro_speak' || msg.action === 'kokoro_export') {
    const missing = await kokoroVendorMissing();
    if (missing) {
      notifyKokoroVendorMissing(tabId);
      return;
    }
  }

  if (msg.action === 'kokoro_export') {
    await withKokoroActiveTab(async () => {
      const activeTab = kokoroActiveTabId;
      if (activeTab && activeTab !== tabId) interruptKokoroTab(activeTab);
      await clearKokoroActiveTab(activeTab);
    });
    await sendToOffscreen({ action: 'kokoro_stop', tabId });
    sendToOffscreen({ ...msg, tabId });
    return;
  }

  if (msg.action === 'kokoro_speak' && tabId) {
    await withKokoroActiveTab(async () => {
      const activeTab = kokoroActiveTabId;
      if (activeTab && activeTab !== tabId) interruptKokoroTab(activeTab);
      await setKokoroActiveTab(tabId, msg.playbackId);
    });
  }

  sendToOffscreen({ ...msg, tabId });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'kokoro_load' || msg.action === 'kokoro_speak' || msg.action === 'kokoro_stop' || msg.action === 'kokoro_pause' || msg.action === 'kokoro_resume' || msg.action === 'kokoro_warm_voice' || msg.action === 'kokoro_export' || msg.action === 'kokoro_export_cancel' || msg.action === 'kokoro_load_cancel') {
    const tabId = sender.tab?.id;
    if (msg.action === 'kokoro_stop' || msg.action === 'kokoro_pause' || msg.action === 'kokoro_resume' || msg.action === 'kokoro_load_cancel') {
      enqueueKokoroAction(async () => {
        if (msg.action === 'kokoro_stop' && tabId) {
          await withKokoroActiveTab(() => clearKokoroActiveTab(tabId, msg.playbackId));
        }
        const exists = await chrome.offscreen.hasDocument().catch(() => false);
        if (exists) await sendToOffscreen({ ...msg, tabId });
      });
      return;
    }
    if (msg.action === 'kokoro_export_cancel') {
      enqueueKokoroAction(() => sendToOffscreen({ ...msg, tabId }));
      return;
    }
    if (msg.action === 'kokoro_load' || msg.action === 'kokoro_speak' || msg.action === 'kokoro_export') {
      enqueueKokoroAction(() => routeKokoroAction(msg, tabId));
      return;
    }
    enqueueKokoroAction(() => sendToOffscreen({ ...msg, tabId }));
    return;
  }

  if (
    msg.action === 'kokoro_ready'  ||
    msg.action === 'kokoro_progress' ||
    msg.action === 'kokoro_chunk'    || msg.action === 'kokoro_end'    ||
    msg.action === 'kokoro_error'    ||
    msg.action === 'kokoro_load_cancelled' ||
    msg.action === 'kokoro_export_progress' ||
    msg.action === 'kokoro_export_error'
  ) {
    if (msg.action === 'kokoro_end' && msg.tabId) {
      withKokoroActiveTab(() => clearKokoroActiveTab(msg.tabId, msg.playbackId));
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
