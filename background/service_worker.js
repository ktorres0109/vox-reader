// Vox Reader — background service worker

chrome.runtime.onInstalled.addListener(() => {
  // Clear stale position/progress prefs from older versions
  chrome.storage.sync.remove(['currentWord', 'playerX', 'playerY']);
});

// ── Offscreen document management ──────────────────────────────────────────
let offscreenCreating = false;
let offscreenReady = false;
let pendingOffscreenMsg = null; // buffered while offscreen loads

async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument().catch(() => false);
  if (exists) return;
  if (offscreenCreating) {
    // Wait for in-progress creation
    await new Promise(res => setTimeout(res, 600));
    return;
  }
  offscreenCreating = true;
  offscreenReady = false;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Kokoro neural TTS synthesis and audio playback',
    });
  } finally {
    offscreenCreating = false;
  }
}

// Send a message to the offscreen document.
// Retries until the document is ready (it signals readiness via offscreen_ready).
async function sendToOffscreen(msg) {
  await ensureOffscreen();

  if (offscreenReady) {
    chrome.runtime.sendMessage({ ...msg, target: 'offscreen' }).catch(() => {});
    return;
  }

  // Offscreen doc is still loading its 800KB module — buffer the message.
  // offscreen_ready handler below will flush it.
  pendingOffscreenMsg = { ...msg, target: 'offscreen' };
}

// ── Message routing ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Offscreen doc finished loading — flush any buffered message
  if (msg.action === 'offscreen_ready') {
    offscreenReady = true;
    if (pendingOffscreenMsg) {
      chrome.runtime.sendMessage(pendingOffscreenMsg).catch(() => {});
      pendingOffscreenMsg = null;
    }
    return;
  }

  // Content script → offscreen: kokoro commands
  if (msg.action === 'kokoro_load' || msg.action === 'kokoro_speak' || msg.action === 'kokoro_stop') {
    const tabId = sender.tab?.id;
    sendToOffscreen({ ...msg, tabId });
    sendResponse({ ok: true });
    return true;
  }

  // Offscreen → content tab: status/data messages (offscreen includes tabId)
  if (
    msg.action === 'kokoro_progress' || msg.action === 'kokoro_ready'  ||
    msg.action === 'kokoro_chunk'    || msg.action === 'kokoro_end'    ||
    msg.action === 'kokoro_error'
  ) {
    if (msg.tabId) {
      chrome.tabs.sendMessage(msg.tabId, msg).catch(() => {});
    }
    return;
  }
});
