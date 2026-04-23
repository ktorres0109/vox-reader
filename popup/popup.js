// #region agent log
chrome.runtime.sendMessage({
  action: 'debug_log',
  payload: {
    sessionId: '31d6d1',
    runId: 'pre-fix',
    hypothesisId: 'H8',
    location: 'popup/popup.js:topLevel',
    message: 'popup evaluated',
    data: {},
    timestamp: Date.now()
  }
}).catch(() => {});
// #endregion

chrome.storage.sync.get('shortcuts', (p) => {
  const sc = p.shortcuts || {};
  const play = (sc.play || 'p').toUpperCase();
  const stop = (sc.stop || 's').toUpperCase();
  const read = (sc.read || 'r').toUpperCase();
  document.getElementById('sc-play-display').textContent = `Alt+${play}`;
  document.getElementById('sc-stop-display').textContent = `Alt+${stop}`;
  document.getElementById('sc-read-display').textContent = `Alt+${read}`;
});

document.getElementById('open-player').addEventListener('click', async () => {
  // #region agent log
  chrome.runtime.sendMessage({
    action: 'debug_log',
    payload: {
      sessionId: '31d6d1',
      runId: 'pre-fix',
      hypothesisId: 'H8',
      location: 'popup/popup.js:openPlayerClick',
      message: 'open player clicked',
      data: {},
      timestamp: Date.now()
    }
  }).catch(() => {});
  // #endregion
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'toggle_player' });
    window.close();
  } catch (_) {
    // Content script not yet injected — try injecting manually
    // (will throw on chrome:// or policy-blocked pages — catch and show error)
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/content.css'] });
      await chrome.tabs.sendMessage(tab.id, { action: 'toggle_player' });
      window.close();
    } catch (e) {
      const btn = document.getElementById('open-player');
      btn.textContent = 'Cannot run on this page';
      btn.style.background = '#555';
      btn.disabled = true;
    }
  }
});
