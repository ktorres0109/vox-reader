// Vox Reader — floating player markup, mounted in an open shadow root.
// content.js owns behaviour; this file only builds the DOM so it stays readable.
// Element ids are unique inside the shadow root; content.js looks them up with $().

(function (root) {
  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 6.3v11.4a.8.8 0 0 1-1.2.7L10 13a1.2 1.2 0 0 1 0-2l8.8-5.4a.8.8 0 0 1 1.2.7z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 6.3v11.4a.8.8 0 0 0 1.2.7L14 13a1.2 1.2 0 0 0 0-2L5.2 5.6A.8.8 0 0 0 4 6.3z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 4.6.1-1.1-.1-1.1 2-1.6-2-3.4-2.4 1a8 8 0 0 0-1.9-1.1L15.7 3h-4l-.4 2.6a8 8 0 0 0-1.9 1.1l-2.4-1-2 3.4 2 1.6-.1 1.1.1 1.1-2 1.6 2 3.4 2.4-1a8 8 0 0 0 1.9 1.1l.4 2.6h4l.4-2.6a8 8 0 0 0 1.9-1.1l2.4 1 2-3.4z"/></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5a1.5 1.5 0 0 0 0 3H20v1H6.5A2.5 2.5 0 0 1 4 19.5zM7 6v2h9V6z"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>',
  };

  const SPEEDS = [0.75, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  function speedLabel(v) {
    return (Math.round(v * 100) / 100).toString() + '×';
  }

  function opt(value, label, current) {
    return `<option value="${value}"${String(current) === String(value) ? ' selected' : ''}>${label}</option>`;
  }

  function seg(id, items, current, aria) {
    return `<div class="vs-seg" id="${id}" role="group" aria-label="${aria}">` +
      items.map(([v, l]) => `<button type="button" data-value="${v}" aria-pressed="${String(current) === String(v)}">${l}</button>`).join('') +
      '</div>';
  }

  /** Markup for the shadow root. `s` is the content script's state (read only). */
  function markup(s) {
    const isKokoro = s.voiceEngine === 'kokoro';
    return `
<div id="vox-shell">
  <div id="vox-kokoro-install" class="vox-banner vs-hidden" role="alert" aria-live="polite">
    <p id="vox-install-status">AI Neural voice required — downloading once (~86MB)</p>
    <progress id="vox-install-progress" max="100" value="0" aria-label="Download progress"></progress>
    <p id="vox-install-file" class="vs-label-muted"></p>
    <button type="button" class="vs-install-cancel vs-hidden" id="vox-install-cancel">Cancel download</button>
  </div>

  <div id="vox-resume" class="vox-banner vs-hidden" role="group" aria-label="Resume reading">
    <span id="vox-resume-text">Resume from 0%?</span>
    <button type="button" class="vs-btn primary" id="vox-resume-yes">Resume</button>
    <button type="button" class="vs-btn" id="vox-resume-no">Start over</button>
  </div>

  <button type="button" id="vox-back-to-reading" class="vs-hidden">↓ Back to reading</button>

  <div id="vox-bar" role="toolbar" aria-label="Vox Reader player">
    <button class="vox-bar-btn" id="vox-back-bar" title="Previous sentence (←)" aria-label="Previous sentence">${ICON.prev}</button>
    <button id="vox-playpause-bar" aria-label="Play" title="Play / pause (Space)">${ICON.play}</button>
    <button class="vox-bar-btn" id="vox-fwd-bar" title="Next sentence (→)" aria-label="Next sentence">${ICON.next}</button>
    <div class="vox-div" aria-hidden="true"></div>
    <div id="vox-progress-wrap">
      <input type="range" id="vox-progress" min="0" max="1000" value="0"
        aria-label="Reading position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="vox-meta">
        <span id="vox-status" role="status" aria-live="polite">Ready</span>
        <span id="vox-time-left"></span>
      </div>
    </div>
    <div class="vox-div" aria-hidden="true"></div>
    <button class="vox-pill" id="vox-speed-pill" aria-haspopup="true" aria-expanded="false" aria-label="Playback speed">${speedLabel(s.speed)}</button>
    <button class="vox-pill" id="vox-voice-pill" aria-haspopup="true" aria-expanded="false" aria-label="Voice">Voice</button>
    <button class="vox-bar-btn" id="vox-immersive-btn" title="Immersive reader" aria-label="Toggle immersive reader">${ICON.book}</button>
    <button class="vox-bar-btn" id="vox-settings-btn" title="Settings" aria-label="Open settings" aria-haspopup="true" aria-expanded="false">${ICON.gear}</button>
    <button class="vox-bar-btn" id="vox-close-bar" title="Close" aria-label="Close player">${ICON.close}</button>
  </div>

  <div class="vox-pop" id="vox-speed-menu" role="dialog" aria-label="Speed">
    <p class="vox-pop-title">Speed</p>
    <div class="vox-speed-grid" role="radiogroup" aria-label="Preset speeds">
      ${SPEEDS.map((v) => `<button type="button" class="vox-speed-opt" role="radio" data-speed="${v}" aria-checked="${Math.abs(v - s.speed) < 0.01}">${speedLabel(v)}</button>`).join('')}
    </div>
    <div class="vs-speed-row">
      <span class="vs-speed-dim">0.5×</span>
      <input type="range" id="vox-speed-slider" min="0.5" max="3.0" step="0.05" value="${s.speed}" aria-label="Speed">
      <span class="vs-speed-val" id="vox-speed-val">${speedLabel(s.speed)}</span>
    </div>
  </div>

  <div class="vox-pop" id="vox-voice-menu" role="dialog" aria-label="Voice">
    <p class="vox-pop-title">Voice</p>
    <div class="vs-engine-row" role="group" aria-label="Voice engine">
      <button class="vs-engine-btn ${s.voiceEngine === 'classic' ? 'active' : ''}" id="eng-classic" aria-pressed="${s.voiceEngine === 'classic'}">Classic</button>
      <button class="vs-engine-btn ${isKokoro ? 'active' : ''}" id="eng-kokoro" aria-pressed="${isKokoro}">AI Neural (offline)</button>
    </div>
    <div class="${isKokoro ? 'vs-hidden' : ''}" id="vox-classic-voice-section">
      <select id="vox-voice-select" aria-label="Select voice"></select>
      <p class="vs-note">System voices from your OS.</p>
    </div>
    <div class="${isKokoro ? '' : 'vs-hidden'}" id="vox-kokoro-section">
      <select id="vox-kokoro-voice-select" aria-label="Kokoro voice"></select>
      <div class="vs-row" style="margin-top:8px"><span class="vs-k">Runs on</span>${seg('device-seg', [['auto', 'GPU if available'], ['wasm', 'CPU only']], s.kokoroDevice, 'AI voice hardware')}</div>
      <p class="vs-kokoro-info" id="vox-device-note">Runs on this device. One-time download, then works offline.</p>
    </div>
  </div>

  <div class="vox-pop" id="vox-settings" role="dialog" aria-label="Settings">
    <div id="vox-settings-header">
      <span class="vox-settings-title">Settings</span>
      <button id="vox-settings-close" aria-label="Close settings">✕</button>
    </div>
    <div id="vox-settings-body">
      <div class="vs">
        <span class="vs-label">Highlight</span>
        <div class="vs-row">
          <span class="vs-k">Follow</span>
          ${seg('hl-mode', [['word', 'Word'], ['sentence', 'Sentence'], ['off', 'Off']], s.highlightMode, 'Highlight mode')}
        </div>
        <p class="vs-note">Word timing is estimated; Sentence is steadier.</p>
        <div class="vs-row">
          <span class="vs-k">Style</span>
          <button class="vs-hl-btn ${s.sentenceStyle === 'bg' ? 'active' : ''}" id="hl-bg" aria-pressed="${s.sentenceStyle === 'bg'}">Fill</button>
          <button class="vs-hl-btn ${s.sentenceStyle === 'underline' ? 'active' : ''}" id="hl-ul" aria-pressed="${s.sentenceStyle === 'underline'}">Underline</button>
          <input class="vs-hex-mini" id="hex-word" maxlength="7" value="${s.wordColor}" title="Word color" aria-label="Word color" style="border-color:${s.wordColor}">
          <input class="vs-hex-mini" id="hex-sentence" maxlength="7" value="${s.sentenceHex}" title="Sentence color" aria-label="Sentence color" style="border-color:${s.sentenceHex}">
        </div>
      </div>

      <div class="vs">
        <span class="vs-label">Appearance</span>
        <div class="vs-row"><span class="vs-k">Theme</span>${seg('theme-seg', [['dark', 'Dark'], ['sepia', 'Sepia'], ['light', 'Light']], s.theme, 'Theme')}</div>
        <div class="vs-row"><span class="vs-k">Font</span>${seg('font-seg', [['serif', 'Serif'], ['sans', 'Sans']], s.readerFont, 'Reader font')}
          <button type="button" class="vs-btn" id="size-down" aria-label="Smaller text">A−</button>
          <span class="vs-note" id="size-val" style="margin:0">${s.readerSize}px</span>
          <button type="button" class="vs-btn" id="size-up" aria-label="Larger text">A+</button>
        </div>
        <div class="vs-row"><span class="vs-k">Width</span>${seg('width-seg', [['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide']], s.readerWidth, 'Reader width')}</div>
        <div class="vs-row"><span class="vs-k">Spacing</span>${seg('line-seg', [['1.5', 'Tight'], ['1.8', 'Normal'], ['2.1', 'Loose']], s.readerLine, 'Line spacing')}</div>
        <p class="vs-note">Theme applies to the player and the immersive reader; font, size, width and spacing to the immersive reader (book icon).</p>
      </div>

      <div class="vs vs-hidden" id="vox-chat-read-section">
        <span class="vs-label">Chat reading</span>
        <div class="vs-row">
          <select id="chat-read-scope" class="vs-export-format" aria-label="Which replies to read">
            ${opt('all', 'All replies', s.chatReadScope)}${opt('latest', 'Latest only', s.chatReadScope)}${opt('single', 'One reply', s.chatReadScope)}
          </select>
          <select id="chat-read-index" class="vs-export-format vs-hidden" aria-label="Reply number"></select>
        </div>
      </div>

      <div class="vs">
        <span class="vs-label">Export audio</span>
        <div class="vs-row">
          <select id="export-scope" class="vs-export-format" aria-label="Export scope" title="What to export">
            ${opt('all', 'All', s.exportScope)}${opt('selection', 'Selection', s.exportScope)}${opt('here', 'From here', s.exportScope)}
          </select>
          <select id="export-format" class="vs-export-format" aria-label="Export format" title="Export format">
            ${opt('mp3', 'MP3', s.exportFormat)}${opt('wav', 'WAV', s.exportFormat)}
          </select>
          <select id="export-bitrate" class="vs-export-format ${s.exportFormat === 'wav' ? 'vs-hidden' : ''}" aria-label="MP3 bitrate" title="MP3 bitrate">
            ${opt(96, '96k', s.exportBitrate)}${opt(128, '128k', s.exportBitrate)}${opt(192, '192k', s.exportBitrate)}
          </select>
          <button class="vs-export-btn" id="exp-mp3" title="Download audio">Export</button>
          <button class="vs-export-btn" id="exp-pdf" title="Print this page">Print</button>
        </div>
      </div>

      <div class="vs">
        <span class="vs-label">Shortcuts</span>
        <p class="vs-note" style="margin:0 0 6px">While reading: Space pause · ← → sentence · [ ] or − + speed</p>
        <div class="vs-sc-inline">
          <span class="vs-sc-lbl">Alt+</span>
          <label class="vs-sc-pair"><span>play</span><input class="vs-sc-input" id="sc-play" maxlength="1"></label>
          <label class="vs-sc-pair"><span>stop</span><input class="vs-sc-input" id="sc-stop" maxlength="1"></label>
          <label class="vs-sc-pair"><span>sel</span><input class="vs-sc-input" id="sc-read" maxlength="1"></label>
          <label class="vs-sc-pair"><span>exp</span><input class="vs-sc-input" id="sc-export" maxlength="1"></label>
          <button class="vs-sc-save" id="sc-save">Save</button>
        </div>
      </div>
    </div>
  </div>
</div>`;
  }

  function adoptCss(shadow) {
    const css = root.VOX_PLAYER_CSS || '';
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
      return;
    } catch (_) { /* fall back to a <style> element */ }
    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
  }

  /** Create (or return) the player host. Returns { host, shadow }. */
  function mount(state) {
    let host = document.getElementById('vox-player');
    if (host && host.shadowRoot) return { host, shadow: host.shadowRoot, created: false };
    // A custom tag (not <div>) so site rules like `div { ... }` never match the host.
    host = document.createElement('vox-reader-player');
    host.id = 'vox-player';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Vox Reader player');
    host.dataset.theme = state.theme || 'dark';
    const shadow = host.attachShadow({ mode: 'open' });
    adoptCss(shadow);
    const wrap = document.createElement('div');
    wrap.innerHTML = markup(state);
    while (wrap.firstChild) shadow.appendChild(wrap.firstChild);
    document.documentElement.appendChild(host);
    return { host, shadow, created: true };
  }

  // Highlight styles injected into foreign shadow roots Vox reads inside (Focus Reader),
  // where content.css cannot reach. Colors come from inherited custom properties.
  function highlightCss(sentenceStyle) {
    const sentence = sentenceStyle === 'underline'
      ? 'background: transparent; border-bottom: 2px solid var(--vox-sentence-color, #f59e0b);'
      : 'background: var(--vox-sentence-bg, rgba(245,158,11,0.25));';
    return `.vox-sentence-active { border-radius: 2px; ${sentence} }
.vox-word-active { background: var(--vox-word-color, #f59e0b) !important; color: #111 !important;
  border-radius: 2px; box-shadow: 0 0 0 1px var(--vox-word-color, #f59e0b); }`;
  }

  root.VoxPlayerUI = { mount, ICON, SPEEDS, speedLabel, highlightCss };
})(globalThis);
