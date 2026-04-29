// Vox Reader — background service worker

chrome.runtime.onInstalled.addListener(() => {
  // Clear stale position/progress prefs from older versions
  chrome.storage.sync.remove(['currentWord', 'playerX', 'playerY']);
});

// ── Offscreen document management ──────────────────────────────────────────
let offscreenCreating = false;

async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument().catch(() => false);
  if (exists) return;
  if (offscreenCreating) {
    // Wait for in-progress creation
    await new Promise(res => setTimeout(res, 500));
    return;
  }
  offscreenCreating = true;
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

// ── Message routing ─────────────────────────────────────────────────────────
// content → offscreen: kokoro_load, kokoro_speak, kokoro_stop
// offscreen → content: kokoro_progress, kokoro_ready, kokoro_chunk, kokoro_end, kokoro_error

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Content script → offscreen (content tab initiates)
  if (msg.action === 'kokoro_load' || msg.action === 'kokoro_speak' || msg.action === 'kokoro_stop') {
    const tabId = sender.tab?.id;
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage({ ...msg, target: 'offscreen', tabId })
        .catch(() => {}); // offscreen may not be ready yet, content will retry
    });
    sendResponse({ ok: true });
    return true;
  }

  // Offscreen → content tab (offscreen includes tabId in its messages)
  if (
    msg.action === 'kokoro_progress' || msg.action === 'kokoro_ready' ||
    msg.action === 'kokoro_chunk'    || msg.action === 'kokoro_end'   ||
    msg.action === 'kokoro_error'
  ) {
    if (msg.tabId) {
      chrome.tabs.sendMessage(msg.tabId, msg).catch(() => {});
    }
    return;
  }
});
