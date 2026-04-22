// Vox Reader - background service worker

chrome.runtime.onInstalled.addListener(() => {
  // Clear stale position/progress prefs from older versions
  chrome.storage.sync.remove(['currentWord', 'playerX', 'playerY']);
  // #region agent log
  fetch('http://127.0.0.1:7876/ingest/2a697698-09f9-450b-8b1c-61fa73bd52cf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '31d6d1'
    },
    body: JSON.stringify({
      sessionId: '31d6d1',
      runId: 'pre-fix',
      hypothesisId: 'H6',
      location: 'background/service_worker.js:onInstalled',
      message: 'service worker installed',
      data: {},
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
});

// #region agent log
fetch('http://127.0.0.1:7876/ingest/2a697698-09f9-450b-8b1c-61fa73bd52cf', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Debug-Session-Id': '31d6d1'
  },
  body: JSON.stringify({
    sessionId: '31d6d1',
    runId: 'pre-fix',
    hypothesisId: 'H6',
    location: 'background/service_worker.js:topLevel',
    message: 'service worker evaluated',
    data: {},
    timestamp: Date.now()
  })
}).catch(() => {});
// #endregion

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action !== 'debug_log' || !msg.payload) return;
  // #region agent log
  fetch('http://127.0.0.1:7876/ingest/2a697698-09f9-450b-8b1c-61fa73bd52cf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '31d6d1'
    },
    body: JSON.stringify(msg.payload)
  }).catch(() => {});
  // #endregion
});

