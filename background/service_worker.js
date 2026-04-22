// Vox Reader - background service worker

chrome.runtime.onInstalled.addListener(() => {
  // Clear stale position/progress prefs from older versions
  chrome.storage.sync.remove(['currentWord', 'playerX', 'playerY']);
});

