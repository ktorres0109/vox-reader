// Vox Reader — background service worker

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.remove(['currentWord', 'playerX', 'playerY']);
});

// ── Offscreen document management ──────────────────────────────────────────
let offscreenCreating = false;

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
      justification: 'Kokoro neural TTS synthesis and audio playback',
    });
  } finally {
    offscreenCreating = false;
  }
}

// Send to offscreen with retry — handles both first-create and already-exists cases.
// When doc exists from a previous SW lifecycle, offscreen_ready was already sent and
// won't fire again, so we must poll directly instead of waiting for the signal.
async function sendToOffscreen(msg, maxRetries = 12) {
  await ensureOffscreen();
  const fullMsg = { ...msg, target: 'offscreen' };
  for (let i = 0; i < maxRetries; i++) {
    try {
      await chrome.runtime.sendMessage(fullMsg);
      return; // success
    } catch (_) {
      // Offscreen doc still loading its module — wait and retry
      await new Promise(r => setTimeout(r, 400));
    }
  }
}

// ── Message routing ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Content → offscreen
  if (msg.action === 'kokoro_load' || msg.action === 'kokoro_speak' || msg.action === 'kokoro_stop') {
    const tabId = sender.tab?.id;
    sendToOffscreen({ ...msg, tabId });
    sendResponse({ ok: true });
    return true;
  }

  // Offscreen → content tab
  if (
    msg.action === 'kokoro_progress' || msg.action === 'kokoro_ready'  ||
    msg.action === 'kokoro_chunk'    || msg.action === 'kokoro_end'    ||
    msg.action === 'kokoro_error'
  ) {
    if (msg.tabId) chrome.tabs.sendMessage(msg.tabId, msg).catch(() => {});
    return;
  }
});
