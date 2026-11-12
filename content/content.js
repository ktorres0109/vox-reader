// Vox Reader v3 — content script

(function () {
  const IFRAME_SEL_MSG = 'vox-reader-iframe-selection';
  const IFRAME_READ_MSG = 'vox-reader-iframe-read';
  const IFRAME_READ_OK = 'vox-reader-iframe-read-ready';
  const IFRAME_HL_MSG = 'vox-reader-iframe-highlight';
  const IFRAME_CLEAR_MSG = 'vox-reader-iframe-clear';
  const isTopFrame = window.self === window.top;

  // Child frames: selection bridge + local wrap/highlight for cross-origin reads.
  if (!isTopFrame) {
    if (window.__voxReaderFrameBridge) return;
    window.__voxReaderFrameBridge = true;

    const frameWords = [];
    const frameSentences = [];

    function applyFrameTheme(d) {
      if (!d) return;
      if (d.wordColor) {
        document.documentElement.style.setProperty('--vox-word-color', d.wordColor);
      }
      if (d.sentenceHex) {
        document.documentElement.style.setProperty('--vox-sentence-color', d.sentenceHex);
        const h = d.sentenceHex;
        const r = parseInt(h.slice(1, 3), 16);
        const g = parseInt(h.slice(3, 5), 16);
        const b = parseInt(h.slice(5, 7), 16);
        document.documentElement.style.setProperty('--vox-sentence-bg', `rgba(${r},${g},${b},0.25)`);
      }
      document.documentElement.classList.toggle('vox-sentence-style-bg', d.sentenceStyle === 'bg');
      document.documentElement.classList.toggle('vox-sentence-style-underline', d.sentenceStyle === 'underline');
    }

    function buildFrameSentences() {
      frameSentences.length = 0;
      if (!frameWords.length) return;
      let start = 0;
      for (let i = 0; i < frameWords.length; i++) {
        if (/[.!?]["')\]]*$/.test(frameWords[i].text) && frameWords[i].text.length > 1) {
          frameSentences.push({ start, end: i });
          start = i + 1;
        }
      }
      if (start < frameWords.length) frameSentences.push({ start, end: frameWords.length - 1 });
    }

    function getFrameSentenceIdx(wordIdx) {
      for (let i = 0; i < frameSentences.length; i++) {
        const s = frameSentences[i];
        if (wordIdx >= s.start && wordIdx <= s.end) return i;
      }
      return -1;
    }

    function clearFrameHL() {
      document.querySelectorAll('.vox-word-active, .vox-sentence-active').forEach((el) => {
        el.classList.remove('vox-word-active', 'vox-sentence-active');
      });
    }

    function placeFrameSentenceOverlays(si, highlightSentence) {
      if (!highlightSentence || si < 0) return;
      const s = frameSentences[si];
      if (!s) return;
      for (let i = s.start; i <= s.end; i++) {
        frameWords[i]?.el?.classList.add('vox-sentence-active');
      }
    }

    function publishFrameSelection() {
      let text = '';
      try {
        text = (window.getSelection()?.toString() || '').trim();
      } catch (_) {}
      try {
        window.top.postMessage({ source: IFRAME_SEL_MSG, text }, '*');
      } catch (_) {}
    }

    function unwrapFrame() {
      document.querySelectorAll('.vox-word').forEach((sp) => {
        sp.parentNode?.replaceChild(document.createTextNode(sp.textContent), sp);
      });
      clearFrameHL();
      frameWords.length = 0;
      frameSentences.length = 0;
    }

    function wrapTextNode(node, start, end) {
      const full = node.textContent;
      const parent = node.parentNode;
      if (!parent) return;
      const frag = document.createDocumentFragment();
      if (start > 0) frag.appendChild(document.createTextNode(full.slice(0, start)));
      const middle = full.slice(start, end);
      const re = /(\S+|\s+)/g;
      let m;
      while ((m = re.exec(middle)) !== null) {
        if (/\S/.test(m[0])) {
          const span = document.createElement('span');
          span.className = 'vox-word';
          span.textContent = m[0];
          span.dataset.voxIndex = String(frameWords.length);
          frameWords.push({ el: span, text: m[0] });
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode(m[0]));
        }
      }
      if (end < full.length) frag.appendChild(document.createTextNode(full.slice(end)));
      parent.replaceChild(frag, node);
    }

    function wrapFrameRange(range) {
      if (!range || range.collapsed) return false;
      unwrapFrame();
      const root = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      if (!root) return false;

      const textNodes = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
          try {
            return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          } catch (_) {
            return NodeFilter.FILTER_REJECT;
          }
        },
      });
      let n;
      while ((n = walker.nextNode())) textNodes.push(n);

      textNodes.forEach((node) => {
        const full = node.textContent;
        let start = 0;
        let end = full.length;
        if (range.startContainer === node) start = range.startOffset;
        if (range.endContainer === node) end = range.endOffset;
        if (start < end) wrapTextNode(node, start, end);
      });
      return frameWords.length > 0;
    }

    function normText(s) {
      return (s || '').replace(/\s+/g, ' ').trim();
    }

    function findRangeForText(text) {
      const needle = normText(text);
      if (!needle) return null;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      let acc = '';
      const map = [];
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim()) continue;
        const start = acc.length;
        acc += node.textContent;
        map.push({ node, start, end: acc.length });
        acc += ' ';
      }
      const hay = normText(acc);
      const pos = hay.indexOf(needle);
      if (pos < 0) return null;
      const endPos = pos + needle.length;
      let startNode = null;
      let endNode = null;
      let startOff = 0;
      let endOff = 0;
      for (const entry of map) {
        const ns = normText(acc.slice(0, entry.start)).length;
        const ne = normText(acc.slice(0, entry.end)).length;
        if (startNode == null && pos >= ns && pos <= ne) {
          startNode = entry.node;
          startOff = Math.max(0, pos - ns);
        }
        if (endPos >= ns && endPos <= ne) {
          endNode = entry.node;
          endOff = Math.max(0, endPos - ns);
        }
      }
      if (!startNode || !endNode) return null;
      const range = document.createRange();
      try {
        range.setStart(startNode, Math.min(startOff, startNode.length));
        range.setEnd(endNode, Math.min(endOff, endNode.length));
        return range;
      } catch (_) {
        return null;
      }
    }

    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d?.source) return;
      if (d.source === IFRAME_READ_MSG) {
        applyFrameTheme(d);
        let range = null;
        try {
          const sel = window.getSelection();
          if (sel?.rangeCount && normText(sel.toString()) === normText(d.text)) {
            range = sel.getRangeAt(0).cloneRange();
          } else {
            range = findRangeForText(d.text);
          }
        } catch (_) {}
        const ok = range ? wrapFrameRange(range) : false;
        if (ok) buildFrameSentences();
        try {
          window.top.postMessage({
            source: IFRAME_READ_OK,
            ok,
            words: frameWords.map((w) => w.text),
          }, '*');
        } catch (_) {}
        return;
      }
      if (d.source === IFRAME_HL_MSG) {
        clearFrameHL();
        if (typeof d.idx !== 'number' || d.idx < 0) return;
        const si = typeof d.sentenceIdx === 'number'
          ? d.sentenceIdx
          : getFrameSentenceIdx(d.idx);
        placeFrameSentenceOverlays(si, d.highlightSentence !== false);
        if (d.highlightWord !== false) {
          const w = frameWords[d.idx];
          if (w?.el) {
            w.el.classList.add('vox-word-active');
            w.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
        }
        return;
      }
      if (d.source === IFRAME_CLEAR_MSG) {
        unwrapFrame();
      }
    });

    document.addEventListener('selectionchange', publishFrameSelection);
    publishFrameSelection();
    return;
  }

  if (window.__voxReaderLoaded) return;
  window.__voxReaderLoaded = true;
  // Content scripts run in an isolated world, so expose a DOM-only readiness
  // marker for diagnostics and browser smoke tests.
  document.documentElement.dataset.voxReaderLoaded = 'true';

  // chrome.runtime.sendMessage throws synchronously when extension context is invalidated
  // (e.g. after extension reload). Wrapping in try-catch prevents uncaught errors and
  // ensures callers don't abort mid-function when the throw would skip later statements.
  function sendMsg(msg) {
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (_) {}
  }

  // Stop TTS on any navigation — refresh, back/forward, or SPA route change
  function stopTTS() {
    if (S.voiceEngine === 'kokoro') {
      sendMsg({ action: 'kokoro_stop', session: S.kokoroSession });
    } else {
      window.speechSynthesis.cancel();
    }
  }

  function handleNavigation() {
    S.pendingPlayAfterKokoro = false;
    if (S.speaking || S.paused) stop(false);
    else { stopTTS(); stopTicker(); clearHL(); }
    if (S.immersiveActive) exitImmersive();
  }

  window.addEventListener('beforeunload', () => stopTTS());
  window.addEventListener('pagehide',     () => { savePosition(true); stopTTS(); });

  // SPA navigation — wrap pushState/replaceState to stop reading on route change
  try {
    ['pushState', 'replaceState'].forEach(method => {
      const orig = history[method];
      history[method] = function (...args) {
        handleNavigation();
        return orig.apply(this, args);
      };
    });
  } catch (e) { /* history not writable on this page — skip */ }
  window.addEventListener('popstate', () => handleNavigation());
  window.addEventListener('hashchange', () => handleNavigation());

  // ── State ──────────────────────────────────────────────────────────────────
  const DEFAULT_KOKORO_VOICE = 'af_bella';

  const S = {
    words: [], sentences: [],
    speaking: false, paused: false,
    currentWord: 0, currentSentence: -1,
    speed: 1.0, voice: null, voices: [], selectedVoiceName: '',
    playerEl: null, settingsOpen: false,
    immersiveActive: false, immersiveOverlay: null,
    dragging: false, dragOffsetX: 0, dragOffsetY: 0,
    shortcuts: { play: 'p', stop: 's', read: 'r', export: 'e' },
    highlightWord: true, highlightSentence: true,
    sentenceStyle: 'bg',          // 'bg' | 'underline'
    wordColor: '#f59e0b',
    sentenceHex: '#f59e0b',
    scrubbing: false,
    overlayRafPending: false,
    // ── AI voice engine ──
    voiceEngine: 'kokoro',        // default — AI Neural with Bella; classic available in Settings
    kokoroModelCached: false,     // true once model has successfully loaded (persisted to storage.local)
    kokoroLoading: false,         // model load in progress this session
    kokoroVoice: DEFAULT_KOKORO_VOICE,
    kokoroDownloadPct: 0,
    exporting: false,
    pendingExport: false,
    exportFormat: 'mp3',
    exportScope: 'all',
    exportBitrate: 128,
    playAfterExport: false,
    pendingPlayAfterKokoro: false,
    pendingPlayStartIdx: 0,
    chatDomDirty: false,          // chat DOM changed since last wrap
    chatReadScope: 'all',         // all | latest | single (chat sites)
    chatReadIndex: 0,
    iframeReadActive: false,
    speakEndIdx: null,            // when set, stop reading at this word index
    speakStartIdx: null,          // first word of a bounded read (selection)
    charPrefix: null,             // spoken-char prefix sums for time-left
    measuredCps: 0,               // Kokoro chars/sec at 1.0x, learned from chunks
    lastKokoroChunk: null,        // last applied kokoro_chunk message, for ticker resume
    kokoroSession: 0,             // id echoed by the offscreen doc; stale chunks are ignored
    chunkTimers: [],              // pending applications of chunks scheduled in the future
    pausedAt: 0,
    _voxDomUpdate: false,         // true while wrap/unwrap mutates the page
    // ── Player / reader appearance ──
    highlightMode: 'word',        // word | sentence | off (derived from the two flags)
    theme: 'dark',                // dark | sepia | light
    readerFont: 'serif',          // serif | sans (immersive reader)
    readerSize: 19,
    readerWidth: 'medium',        // narrow | medium | wide
    readerLine: '1.8',
    readTitle: '',                // title for media session (external reads)
    trackPosition: false,         // save per-page position for this read
    kokoroDevice: 'auto',         // auto (WebGPU, else CPU) | wasm (CPU only)
    kokoroBackend: '',            // backend the offscreen doc actually loaded
    followPaused: false,          // user scrolled away; don't auto-scroll until "Back to reading"
  };

  // Player elements live in the player's shadow root; everything else (immersive
  // reader) in the page. $() looks in the shadow root first.
  function $(id) {
    const shadow = S.playerEl?.shadowRoot;
    return (shadow && shadow.getElementById(id)) || document.getElementById(id);
  }

  let frameSelection = { text: '', at: 0 };
  const FRAME_SEL_TTL_MS = 5000;

  window.addEventListener('message', (ev) => {
    if (!ev.data || ev.data.source !== IFRAME_SEL_MSG) return;
    if (typeof ev.data.text !== 'string') return;
    frameSelection = { text: ev.data.text.trim(), at: Date.now() };
  });

  const KOKORO_VOICES = [
    { id: 'af_bella',   label: 'Bella (Female) — default' },
    { id: 'af_sarah',   label: 'Sarah (Female)' },
    { id: 'af_sky',     label: 'Sky (Female)' },
    { id: 'af_nicole',  label: 'Nicole (Female)' },
    { id: 'af_heart',   label: 'Heart (Female)' },
    { id: 'am_adam',    label: 'Adam (Male)' },
    { id: 'am_michael', label: 'Michael (Male)' },
    { id: 'bf_emma',    label: 'Emma (British Female)' },
    { id: 'bf_isabella', label: 'Isabella (British Female)' },
    { id: 'bm_george',  label: 'George (British Male)' },
    { id: 'bm_lewis',   label: 'Lewis (British Male)' },
  ];

  // Highlight mode is stored as the two legacy flags (word implies sentence fill too).
  function highlightModeOf(st) {
    if (st.highlightWord) return 'word';
    if (st.highlightSentence) return 'sentence';
    return 'off';
  }
  function setHighlightMode(mode) {
    S.highlightMode = mode;
    S.highlightWord = mode === 'word';
    S.highlightSentence = mode !== 'off';
  }

  // ── Prefs ──────────────────────────────────────────────────────────────────
  function loadPrefs(cb) {
    chrome.storage.sync.get([
      'speed','voiceName','shortcuts','highlightWord','highlightSentence',
      'sentenceStyle','wordColor','sentenceHex',
      'voiceEngine','kokoroVoice','exportFormat','exportScope','exportBitrate',
      'chatReadScope','chatReadIndex','kokoroDevice',
      'theme','readerFont','readerSize','readerWidth','readerLine',
    ], (p) => {
      if (p.speed != null) S.speed = p.speed;
      if (p.voiceName) S.selectedVoiceName = p.voiceName;
      if (p.shortcuts) S.shortcuts = { ...S.shortcuts, ...p.shortcuts };
      if (p.highlightWord != null) S.highlightWord = p.highlightWord;
      if (p.highlightSentence != null) S.highlightSentence = p.highlightSentence;
      if (p.sentenceStyle) S.sentenceStyle = p.sentenceStyle;
      if (p.wordColor) S.wordColor = p.wordColor;
      if (p.sentenceHex) S.sentenceHex = p.sentenceHex;
      if (p.voiceEngine) S.voiceEngine = p.voiceEngine;
      const knownVoice = KOKORO_VOICES.some(v => v.id === p.kokoroVoice);
      S.kokoroVoice = knownVoice ? p.kokoroVoice : DEFAULT_KOKORO_VOICE;
      if (p.exportFormat === 'wav' || p.exportFormat === 'mp3') S.exportFormat = p.exportFormat;
      if (p.exportScope === 'all' || p.exportScope === 'selection' || p.exportScope === 'here') {
        S.exportScope = p.exportScope;
      }
      if ([96, 128, 192].includes(p.exportBitrate)) S.exportBitrate = p.exportBitrate;
      S.chatReadScope = (p.chatReadScope === 'latest' || p.chatReadScope === 'single') ? p.chatReadScope : 'all';
      if (typeof p.chatReadIndex === 'number' && p.chatReadIndex >= 0) S.chatReadIndex = p.chatReadIndex;
      if (['dark', 'sepia', 'light'].includes(p.theme)) S.theme = p.theme;
      S.kokoroDevice = p.kokoroDevice === 'wasm' ? 'wasm' : 'auto';
      if (p.readerFont === 'sans' || p.readerFont === 'serif') S.readerFont = p.readerFont;
      if (typeof p.readerSize === 'number') S.readerSize = Math.min(30, Math.max(14, p.readerSize));
      if (['narrow', 'medium', 'wide'].includes(p.readerWidth)) S.readerWidth = p.readerWidth;
      if (['1.5', '1.8', '2.1'].includes(p.readerLine)) S.readerLine = p.readerLine;
      S.highlightMode = highlightModeOf(S);
      cb();
    });
  }

  function savePrefs() {
    try {
      chrome.storage.sync.set({
        speed: S.speed, voiceName: S.selectedVoiceName, shortcuts: S.shortcuts,
        highlightWord: S.highlightWord, highlightSentence: S.highlightSentence,
        sentenceStyle: S.sentenceStyle, wordColor: S.wordColor,
        sentenceHex: S.sentenceHex,
        voiceEngine: S.voiceEngine,
        kokoroVoice: S.kokoroVoice,
        exportFormat: S.exportFormat,
        exportScope: S.exportScope,
        exportBitrate: S.exportBitrate,
        chatReadScope: S.chatReadScope,
        chatReadIndex: S.chatReadIndex,
        kokoroDevice: S.kokoroDevice,
        theme: S.theme, readerFont: S.readerFont, readerSize: S.readerSize,
        readerWidth: S.readerWidth, readerLine: S.readerLine,
      });
    } catch(e) { /* extension reloaded mid-session, ignore */ }
  }

  // kokoroModelCached lives in storage.local (not synced — model is device-specific)
  function loadKokoroFlag(cb) {
    const version = chrome.runtime.getManifest().version;
    chrome.storage.local.get(['kokoroModelCached', 'kokoroCacheVersion'], (r) => {
      S.kokoroModelCached = !!r.kokoroModelCached && r.kokoroCacheVersion === version;
      cb();
    });
  }
  function saveKokoroFlag() {
    chrome.storage.local.set({
      kokoroModelCached: true,
      kokoroCacheVersion: chrome.runtime.getManifest().version,
    });
  }
  function invalidateKokoroCache() {
    S.kokoroModelCached = false;
    chrome.storage.local.remove(['kokoroModelCached', 'kokoroCacheVersion']);
  }

  function ensurePlayerReady(cb) {
    loadPrefs(() => loadKokoroFlag(() => {
      createPlayer();
      if (cb) cb();
    }));
  }

  function shortcutKeyMatches(e, key) {
    return e.key.toLowerCase() === (key || '').toLowerCase();
  }

  function broadcastToIframes(payload) {
    document.querySelectorAll('iframe').forEach((f) => {
      try { f.contentWindow?.postMessage(payload, '*'); } catch (_) {}
    });
  }

  function iframeThemePayload() {
    return {
      wordColor: S.wordColor,
      sentenceHex: S.sentenceHex,
      sentenceStyle: S.sentenceStyle,
      highlightWord: S.highlightWord,
      highlightSentence: S.highlightSentence,
    };
  }

  function requestIframeWords(text) {
    return new Promise((resolve) => {
      let best = null;
      function onMsg(ev) {
        if (ev.data?.source !== IFRAME_READ_OK) return;
        if (ev.data.words?.length) best = ev.data.words;
      }
      window.addEventListener('message', onMsg);
      broadcastToIframes({ source: IFRAME_READ_MSG, text, ...iframeThemePayload() });
      setTimeout(() => {
        window.removeEventListener('message', onMsg);
        resolve(best);
      }, 700);
    });
  }

  async function tryIframeSelectionRead(text) {
    const words = await requestIframeWords(text);
    if (!words?.length) return false;
    S.iframeReadActive = true;
    S.words = words.map((t) => ({ text: t, el: null }));
    buildSentences();
    setStatus('Reading selection…', true);
    speakFrom(0, S.words.length - 1);
    return true;
  }

  function clearIframeHighlights() {
    if (!S.iframeReadActive) return;
    broadcastToIframes({ source: IFRAME_CLEAR_MSG });
    S.iframeReadActive = false;
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────
  // Focus Reader (sibling extension) renders the article in an open shadow root.
  // When it is open, Vox reads and highlights inside it instead of the page.
  const FOCUS_READER_HOST = 'focus-reader-host';
  function getFocusReaderShadow() {
    const host = document.getElementById(FOCUS_READER_HOST);
    return host && host.shadowRoot && host.shadowRoot.querySelector('article') ? host.shadowRoot : null;
  }

  /** Document plus any foreign shadow root Vox has wrapped words inside. */
  function wordRoots() {
    const roots = [document];
    const fr = getFocusReaderShadow();
    if (fr) roots.push(fr);
    return roots;
  }
  function qsaAll(sel) {
    const out = [];
    for (const r of wordRoots()) r.querySelectorAll(sel).forEach((el) => out.push(el));
    return out;
  }

  function ensureForeignHighlightStyle() {
    const fr = getFocusReaderShadow();
    if (!fr) return;
    let st = fr.getElementById('vox-reader-hl-style');
    if (!st) {
      st = document.createElement('style');
      st.id = 'vox-reader-hl-style';
      fr.appendChild(st);
    }
    st.textContent = VoxPlayerUI.highlightCss(S.sentenceStyle);
  }

  function applyColors() {
    document.documentElement.style.setProperty('--vox-word-color', S.wordColor);
    const h = S.sentenceHex;
    const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
    S._sentenceRgba = `rgba(${r},${g},${b},0.25)`;
    document.documentElement.style.setProperty('--vox-sentence-color', S.sentenceHex);
    document.documentElement.style.setProperty('--vox-sentence-bg', S._sentenceRgba);
    document.documentElement.classList.toggle('vox-sentence-style-bg', S.sentenceStyle === 'bg');
    document.documentElement.classList.toggle('vox-sentence-style-underline', S.sentenceStyle === 'underline');
    ensureForeignHighlightStyle();
  }

  // ── Skip / readable root ───────────────────────────────────────────────────
  const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','INPUT','TEXTAREA',
    'NAV','ASIDE','TABLE','FIGURE','SELECT','BUTTON','FORM']);
  const SKIP_ROLES = new Set(['navigation','contentinfo','complementary','search']);
  const MATH_CLASS_HINTS = ['math','katex','mathjax','mjx','equation','formula','latex'];
  // Assistant-specific selectors — tried first so user prompts / sidebars are not picked up.
  const ASSISTANT_MESSAGE_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '[data-message-author="assistant"]',
    '.font-claude-response',
    '[data-testid="ai-message"]',
    '[data-testid="message-assistant"]',
    'model-response',
    '.model-response',
    '[data-testid="model-response"]',
    '[data-test-id="model-response"]',
    '.gemini-response',
    '.agent-turn',
  ];
  const CHAT_RESPONSE_SELECTORS = [
    ...ASSISTANT_MESSAGE_SELECTORS,
    '[data-testid*="assistant"]',
    '[data-testid*="model-response"]',
    '[class*="model-response"]',
    '[class*="message-content"]',
    'message-content',
    '.agent-turn',
    '.gemini-response',
  ];

  function isMathLikeText(text) {
    const t = (text || '').trim();
    if (!t) return false;
    if (t.length > 180 && /[∑∫√π∞≈≠≤≥]/.test(t)) return true;
    if (/\\\((.|\n)+\\\)|\\\[(.|\n)+\\\]|\\frac|\\sum|\\int|\\sqrt|\\begin\{.*\}/.test(t)) return true;
    const symbolHits = (t.match(/[∑∫√π∞≈≠≤≥±×÷]/g) || []).length;
    if (symbolHits >= 4 && symbolHits * 8 > t.length) return true;
    return false;
  }

  function isMathElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'math' || tag === 'mjx-container') return true;
    const cls = (el.className || '').toString().toLowerCase();
    if (MATH_CLASS_HINTS.some(h => cls.includes(h))) return true;
    const attrs = `${el.getAttribute('data-testid') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
    return MATH_CLASS_HINTS.some(h => attrs.includes(h));
  }

  function isLikelyMapOrMapOverlay(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.tagName === 'CANVAS' || el.tagName === 'SVG') return true;
    const id = (el.id || '').toLowerCase();
    const cls = (el.className || '').toString().toLowerCase();
    const t = id + ' ' + cls;
    if (/(^|[-_])(map|mapview|gmaps|staticmap|leaflet|mapbox)([-_]|$)/i.test(t)) return true;
    if (t.includes('google-map') || t.includes('gmp-')) return true;
    if (el.getAttribute('data-testid') && /map/i.test(el.getAttribute('data-testid') || '')) return true;
    return false;
  }

  function shouldSkip(el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.id === 'vox-player' || el.closest('#vox-player')) return true;
    if (isLikelyMapOrMapOverlay(el)) return true;
    if (isMathElement(el)) return true;
    const role = el.getAttribute('role');
    if (role && SKIP_ROLES.has(role)) return true;
    const id = (el.id||'').toLowerCase();
    const cls = (el.className||'').toString().toLowerCase().split(/\s+/);
    const exact = ['toc','sidebar','toolbar','breadcrumb','site-nav','page-nav'];
    return exact.includes(id) || cls.some(c => exact.includes(c));
  }

  // Walk variant — includes <pre>/<code> so code blocks are read aloud.
  function shouldSkipWalk(el) {
    const tag = el.tagName;
    if (tag === 'CODE' || tag === 'PRE') {
      return isMathElement(el) || isMathLikeText((el.textContent || '').trim());
    }
    return shouldSkip(el);
  }

  function getLikelyScrollParent(el) {
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const st = window.getComputedStyle(cur);
      const oy = st.overflowY || '';
      const ox = st.overflowX || '';
      if (/(auto|scroll|overlay)/.test(oy) || /(auto|scroll|overlay)/.test(ox)) return cur;
      cur = cur.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollWordIntoView(el) {
    if (!el) return;
    const scrollParent = getLikelyScrollParent(el);
    if (scrollParent === document.scrollingElement || scrollParent === document.documentElement || scrollParent === document.body) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const elRect = el.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    const target = scrollParent.scrollTop + (elRect.top - parentRect.top) - (parentRect.height / 3);
    scrollParent.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  function sortInDocumentOrder(els) {
    return els.slice().sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function innermostOnlyCandidates(nodes) {
    return nodes.filter((n) => !nodes.some((m) => m !== n && n.contains(m)));
  }

  function isUserMessage(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.matches('[data-message-author-role="user"], [data-role="user"], [data-message-author="user"], .user-query, user-query, [data-testid="human-turn-input"]')) return true;
    return !!el.closest('[data-message-author-role="user"], [data-role="user"], [data-message-author="user"], .user-query, user-query, [data-testid="human-turn-input"]');
  }

  function isValidChatRoot(el) {
    if (shouldSkip(el) || isUserMessage(el)) return false;
    const txt = (el.innerText || '').trim();
    if (txt.length < 20) return false;
    if (isMathLikeText(txt)) return false;
    // Off-screen / virtualized messages may have a zero viewport rect but real content.
    const rect = el.getBoundingClientRect();
    const inView = rect.width > 80 && rect.height > 16;
    const hasLayout = el.offsetHeight > 16 || el.scrollHeight > 16;
    return inView || (el.isConnected && hasLayout);
  }

  function rootsTextLength(roots) {
    const list = Array.isArray(roots) ? roots : [roots];
    return list.reduce((n, r) => n + (r.innerText || '').trim().length, 0);
  }

  function normalizeRoots(rootOrRoots) {
    if (!rootOrRoots) return [document.body];
    return Array.isArray(rootOrRoots) ? rootOrRoots : [rootOrRoots];
  }

  function narrowChatRootExcludingMap(host) {
    if (!host || !host.querySelector('canvas')) return host;
    const prefer = host.querySelector(
      '[class*="markdown"], [class*="prose"], [class*="message-text"], [data-testid*="message-text"]'
    );
    if (prefer && !prefer.querySelector('canvas') && (prefer.innerText || '').trim().length > 50) {
      return prefer;
    }
    const cands = [];
    host.querySelectorAll('*').forEach((el) => {
      if (el.tagName === 'CANVAS' || el.querySelector('canvas')) return;
      if (isLikelyMapOrMapOverlay(el)) return;
      const txt = (el.innerText || '').trim();
      if (txt.length < 100) return;
      cands.push(el);
    });
    cands.sort((a, b) => (b.innerText || '').length - (a.innerText || '').length);
    return cands[0] || host;
  }

  function queryChatCandidates(selectors) {
    const candidates = [];
    const seen = new Set();
    function maybeAdd(el) {
      if (seen.has(el) || !isValidChatRoot(el)) return;
      seen.add(el);
      candidates.push(el);
    }
    function testEl(el) {
      for (const sel of selectors) {
        try {
          if (el.matches(sel)) { maybeAdd(el); return; }
        } catch (_) {}
      }
    }
    function walk(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let n = walker.nextNode();
      while (n) {
        testEl(n);
        if (n.shadowRoot) walk(n.shadowRoot);
        n = walker.nextNode();
      }
    }
    if (document.body) walk(document.body);
    return candidates;
  }

  function rootsNeedRewrap() {
    if (!S.words.length || S.chatDomDirty) return true;
    return getReadableRoots().some(root => {
      const text = (root.innerText || '').trim();
      return text.length >= 20 && !root.querySelector('.vox-word');
    });
  }

  function getChatScrollContainer() {
    const roots = getChatRoots();
    if (roots.length) return getLikelyScrollParent(roots[0]);
    const selectors = [
      '[class*="conversation"]', '[class*="chat-history"]',
      '[data-testid*="conversation"]', 'main', '[role="main"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight + 80) return el;
    }
    return null;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Scroll virtualized chat panes to force older messages into the DOM.
  async function loadVirtualizedChatHistory() {
    const container = getChatScrollContainer();
    if (!container || container.scrollHeight <= container.clientHeight + 50) return;

    const savedScroll = container.scrollTop;
    let lastCount = getChatRoots().length;
    let stablePasses = 0;

    container.scrollTop = 0;
    await sleep(150);

    for (let step = 0; step < 50 && stablePasses < 3; step++) {
      const count = getChatRoots().length;
      if (count === lastCount) stablePasses++;
      else { stablePasses = 0; lastCount = count; }

      const next = Math.min(
        container.scrollTop + container.clientHeight * 0.85,
        container.scrollHeight
      );
      if (next <= container.scrollTop) break;
      container.scrollTop = next;
      await sleep(100);
    }

    container.scrollTop = 0;
    await sleep(120);
    container.scrollTop = savedScroll;
    await sleep(80);
  }

  async function confirmFullThreadLoad() {
    try {
      if (sessionStorage.getItem('vox-skip-full-thread') === '1') return false;
    } catch (_) { /* private mode */ }
    const roots = getChatRoots();
    const container = getChatScrollContainer();
    if (!container || container.scrollHeight <= container.clientHeight + 80) return true;
    if (roots.length < 4) return true;
    const load = window.confirm(
      'Load the full conversation for reading?\n\nThis scrolls through chat history to load older messages.'
    );
    if (!load) {
      try { sessionStorage.setItem('vox-skip-full-thread', '1'); } catch (_) {}
    }
    return load;
  }

  let _prepareChain = Promise.resolve();

  async function prepareAndRewrapInner(cb, opts = {}) {
    const chatRoots = getChatRoots();
    const needsFullHistory = opts.forceFullHistory || (
      chatRoots.length && !chatRoots.some(r => r.querySelector('.vox-word'))
    );
    if (needsFullHistory && await confirmFullThreadLoad()) {
      setStatus('Loading conversation…', true);
      await loadVirtualizedChatHistory();
    }
    await new Promise((resolve) => {
      rewrap(() => {
        try { if (cb) cb(); } finally { resolve(); }
      });
    });
  }

  // Serialized: overlapping calls (e.g. read-selection racing the Play button)
  // must not interleave their unwrap/wrap passes.
  function prepareAndRewrap(cb, opts = {}) {
    const run = _prepareChain.then(() => prepareAndRewrapInner(cb, opts));
    _prepareChain = run.catch(() => {});
    return run;
  }

  function isVoxInternalNode(node) {
    if (!node) return true;
    const el = node.nodeType === Node.ELEMENT_NODE ? node
      : node.nodeType === Node.TEXT_NODE ? node.parentElement : null;
    if (!el) return true;
    return !!el.closest('#vox-player, #vox-immersive, .vox-word');
  }

  function hasExternalMutation(mutations) {
    for (const m of mutations) {
      const nodes = [m.target, ...m.addedNodes, ...m.removedNodes];
      for (const n of nodes) {
        if (!isVoxInternalNode(n)) return true;
      }
    }
    return false;
  }

  let chatObserver = null;
  let chatDirtyTimer = null;

  function markChatDomDirty() {
    if (chatDirtyTimer) return;
    chatDirtyTimer = setTimeout(() => {
      chatDirtyTimer = null;
      if (!getChatRoots().length) return;
      S.chatDomDirty = true;
      if (S.speaking || S.paused) scheduleChatPlaybackSync();
      syncChatReadUI();
    }, 400);
  }

  let chatPlaybackSyncTimer = null;

  function wordsDomStale() {
    return S.words.some(w => w.el && !w.el.isConnected);
  }

  function getWordAnchor(idx, radius = 3) {
    const start = Math.max(0, idx - radius);
    const end = Math.min(S.words.length - 1, idx + radius);
    return S.words.slice(start, end + 1).map(w => w.text).join(' ');
  }

  function scheduleChatPlaybackSync() {
    if (chatPlaybackSyncTimer || S.immersiveActive) return;
    chatPlaybackSyncTimer = setTimeout(() => {
      chatPlaybackSyncTimer = null;
      if (!S.chatDomDirty && !wordsDomStale()) return;
      if (!S.speaking && !S.paused) return;
      syncChatDomDuringPlayback();
    }, 700);
  }

  function restartClassicTicker() {
    if (!S.speaking || S.paused || S.voiceEngine !== 'classic') return;
    const cap = S.speakEndIdx != null ? S.speakEndIdx + 1 : S.words.length;
    const timings = buildTimings(S.currentWord, cap);
    startTicker(timings, Date.now());
  }

  function syncChatDomDuringPlayback() {
    if (S.immersiveActive) return;
    const savedIdx = S.currentWord;
    const savedEndIdx = S.speakEndIdx;
    const anchor = getWordAnchor(savedIdx);
    S.chatDomDirty = false;
    stopTicker();
    clearHL();
    rewrap(() => {
      let newIdx = savedIdx;
      if (anchor && S.words.length) {
        const found = findWordIdxForText(anchor, savedIdx);
        // Never rewind highlight during playback or pause — duplicate phrases
        // earlier on the page used to match here and jump backward.
        if (found >= 0) newIdx = Math.max(found, savedIdx);
        else newIdx = Math.min(savedIdx, S.words.length - 1);
      } else {
        newIdx = Math.min(savedIdx, Math.max(0, S.words.length - 1));
      }
      S.currentWord = newIdx;
      if (savedEndIdx != null) {
        S.speakEndIdx = Math.min(savedEndIdx, S.words.length - 1);
        if (S.speakEndIdx < newIdx) S.speakEndIdx = newIdx;
      }
      if (S.words[newIdx]) highlightAt(newIdx);
      if (S.voiceEngine === 'kokoro') restartKokoroTicker();
      else restartClassicTicker();
      scheduleOverlayRefresh();
    });
  }

  function startChatObserver() {
    if (chatObserver) return;
    chatObserver = new MutationObserver((mutations) => {
      if (S._voxDomUpdate) return;
      if (hasExternalMutation(mutations)) markChatDomDirty();
    });
    chatObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function getChatRoots() {
    let candidates = queryChatCandidates(ASSISTANT_MESSAGE_SELECTORS);
    if (!candidates.length) candidates = queryChatCandidates(CHAT_RESPONSE_SELECTORS);
    if (!candidates.length) return [];

    const specific = innermostOnlyCandidates(candidates);
    return sortInDocumentOrder(
      (specific.length ? specific : candidates).map(narrowChatRootExcludingMap)
    ).filter(el => (el.innerText || '').trim().length >= 20);
  }

  function filterChatRootsForRead(roots) {
    if (!roots.length) return roots;
    if (S.chatReadScope === 'latest') return [roots[roots.length - 1]];
    if (S.chatReadScope === 'single') {
      const i = Math.min(Math.max(0, S.chatReadIndex), roots.length - 1);
      return [roots[i]];
    }
    return roots;
  }

  function getReadableRoots() {
    const focus = getFocusReaderShadow();
    if (focus) return [focus.querySelector('article')];

    const chatRoots = getChatRoots();
    if (chatRoots.length) return filterChatRootsForRead(chatRoots);

    const mdBody = document.querySelector(
      '.markdown-body, [class*="markdown-body"], .markdown-content, .md-content, ' +
      '.post-content, .entry-content, .article-content'
    );
    if (mdBody && (mdBody.innerText||'').trim().length > 100) return [mdBody];

    const semantic = document.querySelector('article, main, [role="main"]');
    if (semantic) return [semantic];

    const proseEls = Array.from(document.querySelectorAll('[class*="prose"]'))
      .filter(el => (el.innerText||'').trim().length > 200);
    if (proseEls.length) {
      proseEls.sort((a,b) => (b.innerText||'').length - (a.innerText||'').length);
      return [proseEls[0]];
    }

    const candidates = Array.from(document.querySelectorAll('div, section'))
      .filter(el => (el.innerText||'').trim().length > 300 && !shouldSkip(el));

    let best = null, bestScore = -1;
    for (const el of candidates) {
      const content = el.querySelectorAll('p,li,h1,h2,h3,h4').length;
      const total   = el.querySelectorAll('*').length || 1;
      const density = content / total;
      const score   = density * Math.log((el.innerText||'').length + 1);
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return [best || document.body];
  }

  // Back-compat: single element for callers that expect one root.
  function getRoot() {
    const roots = getReadableRoots();
    return roots.length === 1 ? roots[0] : roots;
  }

  function waitForContent(cb, maxWait = 8000) {
    const start = Date.now();
    let lastLen = 0, stableMs = 0;
    function check() {
      const roots = getReadableRoots();
      const len  = rootsTextLength(roots);
      const elapsed = Date.now() - start;
      if (len > 200) {
        if (len === lastLen) {
          stableMs += 300;
          if (stableMs >= 600) { cb(roots); return; }
        } else {
          stableMs = 0;
        }
      }
      lastLen = len;
      if (elapsed > maxWait) { cb(roots); return; }
      setTimeout(check, 300);
    }
    check();
  }

  // ── Word wrapping ──────────────────────────────────────────────────────────
  function wrapWords(rootOrRoots) {
    S._voxDomUpdate = true;
    try {
      const roots = normalizeRoots(rootOrRoots);
      S.words = []; S.sentences = [];
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (!text.trim()) return;
        if (isMathLikeText(text)) return;
        const footnote = isFootnoteMarker(node.parentElement);
        const frag = document.createDocumentFragment();
        const re = /(\S+|\s+)/g; let m;
        while ((m = re.exec(text)) !== null) {
          if (/\S/.test(m[0])) {
            const span = document.createElement('span');
            span.className = 'vox-word';
            span.textContent = m[0];
            span.dataset.voxIndex = S.words.length;
            S.words.push({ el: span, text: m[0], footnote });
            frag.appendChild(span);
          } else {
            frag.appendChild(document.createTextNode(m[0]));
          }
        }
        node.parentNode.replaceChild(frag, node);
      } else if (node.nodeType === Node.ELEMENT_NODE && !shouldSkipWalk(node)) {
        const before = S.words.length;
        Array.from(node.childNodes).forEach(walk);
        if (node.shadowRoot) Array.from(node.shadowRoot.childNodes).forEach(walk);
        // A heading / paragraph / list item ends a sentence even without punctuation.
        if (SENTENCE_BLOCKS.has(node.tagName) && S.words.length > before) S.words[S.words.length - 1].blockEnd = true;
      }
    }
    roots.forEach(root => Array.from(root.childNodes).forEach(walk));
    buildSentences();
    applyColors();
    } finally {
      S._voxDomUpdate = false;
    }
  }

  function wrapWordsInRange(range) {
    if (!range || range.collapsed) return false;
    S._voxDomUpdate = true;
    try {
      S.words = []; S.sentences = [];

    function intersects(node) {
      try { return range.intersectsNode(node); } catch (_) { return false; }
    }

    const root = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    if (!root) return false;

    const textNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p || shouldSkipWalk(p) || p.closest('#vox-player')) return NodeFilter.FILTER_REJECT;
        return intersects(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    textNodes.forEach((node) => {
      const full = node.textContent;
      let start = 0;
      let end = full.length;
      if (range.startContainer === node) start = range.startOffset;
      if (range.endContainer === node) end = range.endOffset;
      if (start >= end) return;

      const parent = node.parentNode;
      if (!parent) return;
      const before = full.slice(0, start);
      const middle = full.slice(start, end);
      const after = full.slice(end);
      const frag = document.createDocumentFragment();
      if (before) frag.appendChild(document.createTextNode(before));

      if (middle.trim()) {
        const footnote = isFootnoteMarker(node.parentElement);
        const midFrag = document.createDocumentFragment();
        const re = /(\S+|\s+)/g;
        let m;
        while ((m = re.exec(middle)) !== null) {
          if (/\S/.test(m[0])) {
            const span = document.createElement('span');
            span.className = 'vox-word';
            span.textContent = m[0];
            span.dataset.voxIndex = S.words.length;
            S.words.push({ el: span, text: m[0], footnote });
            midFrag.appendChild(span);
          } else {
            midFrag.appendChild(document.createTextNode(m[0]));
          }
        }
        frag.appendChild(midFrag);
      }

      if (after) frag.appendChild(document.createTextNode(after));
      parent.replaceChild(frag, node);
    });

    if (!S.words.length) return false;
    buildSentences();
    applyColors();
    return true;
    } finally {
      S._voxDomUpdate = false;
    }
  }

  const SENTENCE_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'DT', 'DD', 'FIGCAPTION', 'TD', 'TH', 'PRE']);

  // Footnote markers rendered as <sup> (Wikipedia refs, note links) are not spoken.
  function isFootnoteMarker(el) {
    const sup = el && el.closest ? el.closest('sup') : null;
    if (!sup) return false;
    const t = (sup.textContent || '').trim();
    if (!/^\[?[\d,–\-a-z*†‡\s]{1,8}\]?$/i.test(t)) return false;
    return /^\[.*\]$/.test(t)
      || !!sup.querySelector('a[href*="#"]')
      || /reference|footnote|cite|noteref|\bfn/i.test(`${sup.className} ${sup.id}`);
  }

  /** Spoken form per word ('' = silent; see content/lib/text-clean.js), then sentences. */
  function buildSentences() {
    S.sentences = [];
    const spoken = window.VoxTextClean.cleanTokens(S.words);
    S.words.forEach((w, i) => { w.spoken = spoken[i]; });
    if (!S.words.length) { rebuildCharIndex(); return; }
    let start = 0;
    for (let i = 0; i < S.words.length; i++) {
      const t = S.words[i].spoken;
      if ((/[.!?]["')\]\u201d\u2019]*$/.test(t) && t.length > 1) || S.words[i].blockEnd) {
        S.sentences.push({ start, end: i });
        start = i + 1;
      }
    }
    if (start < S.words.length) S.sentences.push({ start, end: S.words.length - 1 });
    rebuildCharIndex();
  }

  function getSentenceIdx(wordIdx) {
    return window.VoxPlayback.sentenceIndexAt(S.sentences, wordIdx);
  }

  function getSentenceWords(si) {
    if (si < 0 || si >= S.sentences.length) return [];
    const { start, end } = S.sentences[si];
    return S.words.slice(start, end + 1);
  }

  function rewrap(cb) {
    // Don't rewrap the regular page while immersive mode is active —
    // immersive mode wraps its own overlay content and rewrapping would
    // strip those spans and then wrap the wrong root.
    if (S.immersiveActive) { if (cb) cb(); return; }
    S.chatDomDirty = false;
    unwrap();
    const roots = getReadableRoots();
    wrapWords(roots);
    if (S.words.length > 0) { if (cb) cb(); return; }
    if (!roots.includes(document.body)) {
      wrapWords(document.body);
      if (S.words.length > 0) { if (cb) cb(); return; }
    }
    waitForContent((r) => {
      if (!S.words.length) wrapWords(r);
      if (!S.words.length && !normalizeRoots(r).includes(document.body)) wrapWords(document.body);
      if (cb) cb();
    });
  }

  function unwrap() {
    S._voxDomUpdate = true;
    clearIframeHighlights();
    qsaAll('.vox-word').forEach(sp =>
      sp.parentNode.replaceChild(document.createTextNode(sp.textContent), sp));
    S.words = []; S.sentences = []; clearHL();
    S._voxDomUpdate = false;
  }

  // ── Highlighting ──────────────────────────────────────────────────────────
  function placeSentenceOverlays(si) {
    qsaAll('.vox-sentence-active').forEach(e => e.classList.remove('vox-sentence-active'));
    if (!S.highlightSentence || si < 0) return;
    const words = getSentenceWords(si);
    if (!words.length) return;
    words.forEach(w => { if (w.el) w.el.classList.add('vox-sentence-active'); });
  }

  function scheduleOverlayRefresh() {
    if (S.overlayRafPending) return;
    S.overlayRafPending = true;
    requestAnimationFrame(() => {
      S.overlayRafPending = false;
      if (!S.highlightSentence || S.currentSentence < 0) return;
      if (!S.speaking && !S.paused) return;
      placeSentenceOverlays(S.currentSentence);
    });
  }

  let _activeWordEl = null;

  function clearHL() {
    if (_activeWordEl) { _activeWordEl.classList.remove('vox-word-active'); _activeWordEl = null; }
    qsaAll('.vox-sentence-active').forEach(e => e.classList.remove('vox-sentence-active'));
    if (S.iframeReadActive) {
      broadcastToIframes({
        source: IFRAME_HL_MSG,
        idx: -1,
        ...iframeThemePayload(),
      });
    }
  }

  function highlightAt(idx) {
    if (S.iframeReadActive) {
      const si = getSentenceIdx(idx);
      if (si !== S.currentSentence) S.currentSentence = si;
      broadcastToIframes({
        source: IFRAME_HL_MSG,
        idx,
        sentenceIdx: si,
        ...iframeThemePayload(),
      });
      updateProgress();
      return;
    }
    if (S.words[idx]?.el && !S.words[idx].el.isConnected) {
      scheduleChatPlaybackSync();
      return;
    }
    if (_activeWordEl) { _activeWordEl.classList.remove('vox-word-active'); _activeWordEl = null; }
    if (S.highlightWord && S.words[idx]?.el) {
      _activeWordEl = S.words[idx].el;
      _activeWordEl.classList.add('vox-word-active');
    }
    const si = getSentenceIdx(idx);
    if (si !== S.currentSentence) {
      const firstWord = S.words[S.sentences[si]?.start];
      if (firstWord?.el) {
        if (!S.followPaused) scrollWordIntoView(firstWord.el);
        else scheduleBackPill();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => placeSentenceOverlays(si));
        });
      } else {
        placeSentenceOverlays(si);
      }
      S.currentSentence = si;
    }
    updateProgress();
  }

  // ── Classic voices (speechSynthesis) ──────────────────────────────────────
  function loadVoices() {
    const all = window.speechSynthesis.getVoices();
    const fkw = ['female','zira','samantha','victoria','karen','moira','veena',
      'susan','fiona','alice','allison','ava','serena','emma','aria'];
    const en = all.filter(v => v.lang.startsWith('en'));
    const fem = en.filter(v => fkw.some(k => v.name.toLowerCase().includes(k)));
    S.voices = fem.length ? fem : en;
    if (S.selectedVoiceName) {
      const m = all.find(v => v.name === S.selectedVoiceName);
      if (m) S.voice = m;
    }
    if (!S.voice && S.voices.length) { S.voice = S.voices[0]; S.selectedVoiceName = S.voice.name; }
    populateVoices();
    syncVoicePill();
  }

  function populateVoices() {
    const sel = $('vox-voice-select');
    if (!sel) return;
    sel.innerHTML = '';
    S.voices.forEach(v => {
      const o = document.createElement('option');
      o.value = v.name;
      o.textContent = v.name.replace(/Microsoft|Google|Apple/gi,'').trim();
      if (v.name === S.selectedVoiceName) o.selected = true;
      sel.appendChild(o);
    });
  }

  // ── TTS timing ─────────────────────────────────────────────────────────────
  const BASE_CPS = window.VoxPlayback.BASE_CPS; // estimated chars/sec at rate 1.0
  // Classic speech engine has ~250ms startup delay; Kokoro plays immediately (AudioContext)
  function STARTUP_MS() { return S.voiceEngine === 'kokoro' ? 20 : 250; }

  function buildTimings(startIdx, endIdx) {
    const end = endIdx ?? S.words.length;
    let offset = 0;
    return S.words.slice(startIdx, end).map((w, i) => {
      const ms = STARTUP_MS() + (offset / (BASE_CPS * S.speed)) * 1000;
      const len = spokenOf(w).length;
      offset += len ? len + 1 : 0;
      return { wordIdx: startIdx + i, ms };
    });
  }

  function stopTicker() {
    if (S._ticker) { clearInterval(S._ticker); S._ticker = null; }
  }

  function startTicker(timings, startMs) {
    stopTicker();
    if (!timings.length) return;
    let ti = 0;
    S._ticker = setInterval(() => {
      if (!S.speaking || S.paused) return;
      const elapsed = Date.now() - startMs;
      while (ti + 1 < timings.length && timings[ti + 1].ms <= elapsed) ti++;
      const wordIdx = timings[ti].wordIdx;
      if (wordIdx > S.currentWord) {
        S.currentWord = wordIdx;
        highlightAt(wordIdx);
      } else if (wordIdx < S.currentWord) {
        while (ti + 1 < timings.length && timings[ti].wordIdx < S.currentWord) ti++;
      }
      if (ti >= timings.length - 1) stopTicker();
    }, 80);
  }

  // ── Classic TTS (speechSynthesis) ──────────────────────────────────────────
  function classicSpeakFrom(idx) {
    window.speechSynthesis.cancel();
    stopTicker(); clearHL();
    S.currentWord = idx; S.currentSentence = -1;
    if (!S.words.length) return;

    const endIdx = S.speakEndIdx != null ? S.speakEndIdx : S.words.length - 1;
    const text = S.words.slice(idx, endIdx + 1).map(spokenOf).filter(Boolean).join(' ');
    if (!text.trim()) { resetPlaybackState(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = S.speed; u.lang = 'en-US';
    if (S.voice) u.voice = S.voice;

    highlightAt(idx);
    const timings = buildTimings(idx, endIdx + 1);
    const startMs = Date.now();
    startTicker(timings, startMs);

    u.onboundary = (ev) => {
      if (ev.name !== 'word') return;
      let cc = 0, wi = idx;
      for (let i = idx; i <= endIdx; i++) {
        const len = spokenOf(S.words[i]).length;
        if (!len) continue;
        if (cc >= ev.charIndex) { wi = i; break; }
        cc += len + 1; wi = i + 1;
      }
      const w = Math.min(wi, endIdx);
      if (w > S.currentWord) { S.currentWord = w; highlightAt(w); }
    };

    u.onend = () => {
      stopTicker(); clearHL();
      S.speaking = false; S.paused = false; S.speakEndIdx = null; S.speakStartIdx = null;
      document.documentElement.classList.remove('vox-reading');
      updatePlayBtn(); setStatus('Done'); S.currentWord = 0;
      if (S.trackPosition) clearPosition();
      maybeRunPendingExport();
    };
    u.onerror = (e) => {
      stopTicker();
      if (e.error === 'interrupted') {
        if (S.paused) return;
        return;
      }
      clearHL(); S.speaking = false; S.paused = false;
      document.documentElement.classList.remove('vox-reading');
      updatePlayBtn(); setStatus('Error');
    };

    S.speaking = true; S.paused = false;
    document.documentElement.classList.add('vox-reading');
    window.speechSynthesis.speak(u);
    updatePlayBtn(); setStatus('Playing', true);
  }

  // ── Kokoro TTS ─────────────────────────────────────────────────────────────
  // Builds sentence list for the offscreen doc: [{text, startWordIdx}]
  function getSentencesFrom(startIdx, endIdx) {
    let startSi = getSentenceIdx(startIdx);
    if (startSi < 0) startSi = 0;
    const cap = endIdx != null ? endIdx : S.words.length - 1;

    const result = [];
    for (let si = startSi; si < S.sentences.length; si++) {
      const { start, end } = S.sentences[si];
      if (start > cap) break;
      const wordStart = si === startSi ? Math.max(start, startIdx) : start;
      const wordEnd = Math.min(end, cap);
      if (wordStart > wordEnd) continue;
      const text = S.words.slice(wordStart, wordEnd + 1).map(spokenOf).filter(Boolean).join(' ');
      if (text.trim()) result.push({ text, startWordIdx: wordStart });
    }
    return result;
  }

  function buildKokoroWordTimings(sent, highlightStart, durationSec) {
    if (!sent || !durationSec) {
      return buildTimings(highlightStart, sent ? sent.end + 1 : undefined);
    }
    const fromLocal = Math.max(0, highlightStart - sent.start);
    const words = S.words.slice(sent.start + fromLocal, sent.end + 1);
    if (!words.length) return [];
    const lenOf = (w) => { const n = spokenOf(w).length; return n ? n + 1 : 0; };
    const totalChars = words.reduce((sum, w) => sum + lenOf(w), 0) || 1;
    let charOffset = 0;
    return words.map((w, i) => {
      const ms = (charOffset / totalChars) * durationSec * 1000;
      charOffset += lenOf(w);
      return { wordIdx: highlightStart + i, ms };
    });
  }

  // The offscreen doc schedules sentences back to back on the audio clock and
  // announces each one ahead of time; startedAt is when it becomes audible.
  function clearChunkTimers() {
    S.chunkTimers.forEach(clearTimeout);
    S.chunkTimers = [];
  }

  function onKokoroChunk(msg) {
    if (msg.session != null && msg.session !== S.kokoroSession) return; // stale read
    if (!S.speaking || S.paused) return; // resume re-sends chunk timing
    const delay = msg.startedAt - Date.now();
    if (delay > 15) {
      const t = setTimeout(() => {
        S.chunkTimers = S.chunkTimers.filter((x) => x !== t);
        if (S.speaking && !S.paused && msg.session === S.kokoroSession) applyKokoroChunk(msg);
      }, delay);
      S.chunkTimers.push(t);
    } else {
      applyKokoroChunk(msg);
    }
  }

  function applyKokoroChunk(msg) {
    const si = getSentenceIdx(msg.startWordIdx);
    const sent = si >= 0 ? S.sentences[si] : null;
    const timings = buildKokoroWordTimings(sent, msg.startWordIdx, msg.duration);
    learnSpeechRate(sent, msg);
    if (msg.startWordIdx > S.currentWord || S.currentSentence !== si) {
      S.currentWord = Math.max(S.currentWord, msg.startWordIdx);
      highlightAt(S.currentWord);
    }
    startTicker(timings, msg.startedAt);
    S.lastKokoroChunk = { sent, highlightStart: msg.startWordIdx, duration: msg.duration, startedAt: msg.startedAt };
    setStatus('Playing', true);
  }

  // Learn Kokoro's real speaking rate from whole-sentence chunks so "min left" is honest.
  function learnSpeechRate(sent, msg) {
    if (!sent || msg.startWordIdx !== sent.start || !(msg.duration > 0.8) || !S.charPrefix) return;
    const chars = S.charPrefix[sent.end + 1] - S.charPrefix[sent.start];
    if (chars < 12) return;
    const cps = chars / (msg.duration * (S.speed || 1));
    S.measuredCps = S.measuredCps ? S.measuredCps * 0.8 + cps * 0.2 : cps;
  }

  function restartKokoroTicker() {
    if (!S.speaking || S.paused || S.voiceEngine !== 'kokoro' || !S.lastKokoroChunk) return;
    const { sent, highlightStart, duration, startedAt } = S.lastKokoroChunk;
    const timings = buildKokoroWordTimings(sent, highlightStart, duration);
    if (!timings.length) return;
    startTicker(timings, startedAt);
    const elapsed = Date.now() - startedAt;
    let ti = 0;
    while (ti + 1 < timings.length && timings[ti + 1].ms <= elapsed) ti++;
    const wordIdx = timings[ti].wordIdx;
    if (wordIdx >= S.currentWord) {
      S.currentWord = wordIdx;
      highlightAt(wordIdx);
    }
  }

  function resetPlaybackState() {
    S.speaking = false; S.paused = false;
    document.documentElement.classList.remove('vox-reading');
    updatePlayBtn();
    setStatus('Nothing to read here');
  }

  function kokoroSpeakFrom(idx) {
    if (!S.kokoroModelCached) {
      S.pendingPlayAfterKokoro = true;
      S.pendingPlayStartIdx = idx;
      setStatus('Downloading AI voice… reading will start when ready', true);
      startKokoroDownload();
      return;
    }
    // No separate kokoro_stop: kokoro_speak replaces the running session, and a
    // stop routed separately through the SW could land after the speak.
    stopTicker(); clearHL(); clearChunkTimers();
    S.lastKokoroChunk = null;
    S.currentSentence = -1;
    if (!S.words.length) { resetPlaybackState(); return; }

    const sentences = getSentencesFrom(idx, S.speakEndIdx);
    if (!sentences.length) { resetPlaybackState(); return; }

    S.currentWord = idx;

    S.speaking = true; S.paused = false;
    document.documentElement.classList.add('vox-reading');
    highlightAt(idx);
    updatePlayBtn(); setStatus('Generating…', true);

    sendMsg({
      action: 'kokoro_speak', sentences, speed: S.speed, voice: S.kokoroVoice, device: S.kokoroDevice,
      session: ++S.kokoroSession,
      title: S.readTitle || document.title || location.hostname,
      site: location.hostname,
    });
  }

  // ── Engine dispatcher ──────────────────────────────────────────────────────
  function speakFrom(idx, endIdx) {
    if (endIdx != null) {
      if (S.speakEndIdx == null) S.speakStartIdx = idx;
      S.speakEndIdx = endIdx;
    }
    // Only whole-page reads of the real page get a saved position.
    S.trackPosition = S.speakEndIdx == null && !S.iframeReadActive && !S.immersiveActive && !!S.words[0]?.el;
    hideResume();
    bringPlayerToFront();
    watchForeignScroll();
    if (S.voiceEngine === 'kokoro') kokoroSpeakFrom(idx);
    else classicSpeakFrom(idx);
  }

  function pauseResume() {
    if (S.paused) {
      S.paused = false;
      if (S.voiceEngine === 'kokoro') {
        sendMsg({ action: 'kokoro_resume', session: S.kokoroSession });
        setStatus('Playing', true);
      } else {
        speakFrom(S.currentWord, S.speakEndIdx);
      }
      updatePlayBtn();
      return;
    }
    if (!S.speaking) return;
    stopTicker(); clearChunkTimers();
    S.pausedAt = Date.now();
    savePosition(true);
    if (S.voiceEngine === 'kokoro') {
      sendMsg({ action: 'kokoro_pause', session: S.kokoroSession });
    } else {
      window.speechSynthesis.cancel();
    }
    S.paused = true;
    setStatus('Paused');
    updatePlayBtn();
  }

  function stop(reset = false) {
    const cancellingExportWait = (S.pendingExport || S.exporting) && !S.speaking;
    const droppedQueuedExport = S.pendingExport && S.speaking;
    S.pendingPlayAfterKokoro = false;
    if (S.exporting) {
      sendMsg({ action: 'kokoro_export_cancel' });
      S.exporting = false;
      syncExportUI();
    }
    if (S.kokoroLoading) {
      sendMsg({ action: 'kokoro_load_cancel' });
      S.kokoroLoading = false;
      S.kokoroDownloadPct = 0;
      syncInstallUI();
    }
    S.pendingExport = false;
    if (S.voiceEngine === 'kokoro') {
      sendMsg({ action: 'kokoro_stop', session: S.kokoroSession });
    } else {
      window.speechSynthesis.cancel();
    }
    if (S.speaking || S.paused) savePosition(true);
    stopTicker(); clearHL(); clearChunkTimers();
    clearIframeHighlights();
    S.lastKokoroChunk = null;
    S.speaking = false; S.paused = false; S.speakEndIdx = null; S.speakStartIdx = null;
    S.readTitle = '';
    if (reset) S.currentWord = 0;
    document.documentElement.classList.remove('vox-reading');
    updatePlayBtn();
    setStatus((cancellingExportWait || droppedQueuedExport) ? 'Export cancelled' : 'Stopped');
    savePrefs();
  }

  // Previous / next sentence. Within a bounded read (selection) stay inside it.
  function skipBack() {
    if (!S.words.length) return;
    const minIdx = S.speakStartIdx != null ? S.speakStartIdx : 0;
    const t = window.VoxPlayback.prevSentenceStart(S.sentences, S.currentWord, minIdx);
    S.currentSentence = -1;
    if (S.speaking || S.paused) speakFrom(t, S.speakEndIdx);
    else { S.currentWord = t; highlightAt(t); }
  }
  function skipFwd() {
    if (!S.words.length) return;
    const maxIdx = S.speakEndIdx != null ? S.speakEndIdx : S.words.length - 1;
    const t = window.VoxPlayback.nextSentenceStart(S.sentences, S.currentWord, maxIdx);
    if (t == null) return;
    S.currentSentence = -1;
    if (S.speaking || S.paused) speakFrom(t, S.speakEndIdx);
    else { S.currentWord = t; highlightAt(t); }
  }

  function findFirstVisibleWordIdx() {
    if (!S.words.length) return 0;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    for (let i = 0; i < S.words.length; i++) {
      const el = S.words[i].el;
      if (!el) continue; // iframe reads have no host-page elements
      const rect = el.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < vh) return i;
    }
    return 0;
  }

  function findWordIdxForText(text, startNear = 0) {
    const parts = text.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return -1;
    const norm = (s) => s.replace(/\W/g, '').toLowerCase();
    const maxLen = Math.min(parts.length, 8);
    const anchorParts = parts.slice(0, maxLen);

    function matchesAt(i) {
      if (i + anchorParts.length > S.words.length) return false;
      for (let j = 0; j < anchorParts.length; j++) {
        if (norm(S.words[i + j].text) !== norm(anchorParts[j])) return false;
      }
      return true;
    }

    for (let i = startNear; i < S.words.length; i++) {
      if (matchesAt(i)) return i;
    }
    for (let i = 0; i < startNear; i++) {
      if (matchesAt(i)) return i;
    }
    const first = norm(parts[0]);
    return S.words.findIndex(w => norm(w.text) === first);
  }

  function getSelectionText() {
    const sel = window.getSelection();
    let text = sel?.toString().trim() || '';
    if (text) return text;
    try {
      const frame = document.activeElement;
      if (frame?.tagName === 'IFRAME' && frame.contentDocument) {
        text = frame.contentDocument.getSelection()?.toString().trim() || '';
        if (text) return text;
      }
    } catch (_) { /* cross-origin iframe */ }
    if (frameSelection.text && Date.now() - frameSelection.at < FRAME_SEL_TTL_MS) {
      return frameSelection.text;
    }
    return '';
  }

  function getSelectionRange() {
    const sel = window.getSelection();
    if (sel?.rangeCount && !sel.isCollapsed) {
      return sel.getRangeAt(0).cloneRange();
    }
    try {
      const frame = document.activeElement;
      if (frame?.tagName === 'IFRAME' && frame.contentDocument) {
        const inner = frame.contentDocument.getSelection();
        if (inner?.rangeCount && !inner.isCollapsed) {
          return inner.getRangeAt(0).cloneRange();
        }
      }
    } catch (_) { /* cross-origin iframe */ }
    return null;
  }

  async function readSelection(fallbackText) {
    const text = (getSelectionText() || fallbackText || '').trim();
    if (!text) {
      setStatus('No text selected');
      return;
    }

    if (!$('vox-player')) createPlayer();

    stop(false);
    unwrap();

    const range = getSelectionRange();
    if (range && wrapWordsInRange(range)) {
      const endIdx = S.words.length - 1;
      setStatus('Reading selection…', true);
      speakFrom(0, endIdx);
      return;
    }

    if (await tryIframeSelectionRead(text)) return;

    await prepareAndRewrap(() => {
      const idx = findWordIdxForText(text);
      if (idx < 0) {
        setStatus('Selection not found on page');
        return;
      }
      const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
      const endIdx = Math.min(idx + wordCount - 1, S.words.length - 1);
      setStatus('Reading selection…', true);
      speakFrom(idx, endIdx);
    });
  }

  async function handleSel(selText, anchor) {
    if (getSelectionText()) {
      await readSelection();
      return;
    }
    if (selText?.trim()) await readSelection(selText);
  }

  // ── Immersive ──────────────────────────────────────────────────────────────
  function toggleImmersive() { S.immersiveActive ? exitImmersive() : enterImmersive(); }

  function enterImmersive() {
    const roots = getReadableRoots();
    const blocks = [];
    roots.forEach(root => {
      const clone = root.cloneNode(true);
      clone.querySelectorAll('script,style,noscript,nav,aside,table,figure,[role="navigation"],[role="complementary"]')
        .forEach(el => el.remove());
      clone.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li').forEach(el => {
        const t = el.textContent.trim();
        if (t.length > 10 && !isMathLikeText(t) && !isMathElement(el)) {
          blocks.push({ tag: el.tagName.toLowerCase(), text: t });
        }
      });
      clone.querySelectorAll('pre, code').forEach(el => {
        if (el.tagName === 'CODE' && el.closest('pre')) return;
        const t = el.textContent.trim();
        if (t.length > 3 && !isMathLikeText(t) && !isMathElement(el)) {
          blocks.push({ tag: 'p', text: t });
        }
      });
      // Chat UIs often use div-only markdown without <p> tags.
      clone.querySelectorAll('div').forEach(el => {
        if (el.querySelector('h1,h2,h3,h4,h5,h6,p,li,div')) return;
        const t = el.textContent.trim();
        if (t.length > 10 && !isMathLikeText(t) && !isMathElement(el)) {
          blocks.push({ tag: 'p', text: t });
        }
      });
    });
    if (!blocks.length) return;

    const ov = document.createElement('div');
    ov.id = 'vox-immersive';
    ov.innerHTML = `
      <div id="vox-immersive-inner">
        <div id="vox-immersive-toolbar">
          <button id="vox-immersive-exit">✕ Exit</button>
          <button class="vox-imm-nav" id="vox-imm-prev">← Prev sentence</button>
          <button class="vox-imm-nav" id="vox-imm-next">Next sentence →</button>
        </div>
        <div id="vox-immersive-content"></div>
      </div>`;
    const contentEl = ov.querySelector('#vox-immersive-content');
    blocks.forEach(b => {
      const tag = b.tag.startsWith('h') ? b.tag : 'p';
      const el = document.createElement(tag);
      el.textContent = b.text;
      contentEl.appendChild(el);
    });
    document.documentElement.appendChild(ov);
    S.immersiveOverlay = ov; S.immersiveActive = true;
    applyAppearance();
    $('vox-immersive-exit').onclick = exitImmersive;

    $('vox-imm-prev').onclick = () => {
      const si = Math.max(0, S.currentSentence - 1);
      if (S.sentences[si]) speakFrom(S.sentences[si].start, S.speakEndIdx);
    };
    $('vox-imm-next').onclick = () => {
      const si = Math.min(S.sentences.length - 1, S.currentSentence + 1);
      if (S.sentences[si]) speakFrom(S.sentences[si].start, S.speakEndIdx);
    };

    const btn = $('vox-immersive-btn');
    if (btn) btn.classList.add('active');
    stop(false); unwrap();
    wrapWords($('vox-immersive-content'));
    syncPrintUI();
  }

  function exitImmersive() {
    stop(true); unwrap();
    if (S.immersiveOverlay) { S.immersiveOverlay.remove(); S.immersiveOverlay = null; }
    S.immersiveActive = false;
    const btn = $('vox-immersive-btn');
    if (btn) btn.classList.remove('active');
    syncPrintUI();
    setStatus('Ready');
  }

  function printReadable() {
    if (!S.immersiveActive) {
      window.print();
      return;
    }
    const content = $('vox-immersive-content');
    if (!content) {
      window.print();
      return;
    }
    const clone = content.cloneNode(true);
    clone.querySelectorAll('.vox-word').forEach((sp) => {
      sp.replaceWith(document.createTextNode(sp.textContent));
    });
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><title>Vox Reader</title>
<style>
  body { font-family: Georgia, serif; max-width: 680px; margin: 2em auto; line-height: 1.75; color: #111; }
  h1,h2,h3,h4 { margin-top: 1.4em; margin-bottom: 0.5em; }
  p,li { margin-bottom: 1em; }
  pre,code { font-family: ui-monospace, monospace; font-size: 0.9em; white-space: pre-wrap; }
</style></head><body>`);
    doc.write(clone.innerHTML);
    doc.write('</body></html>');
    doc.close();
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 1000);
  }

  function syncChatReadUI() {
    const panel = $('vox-chat-read-section');
    if (!panel) return;
    const roots = getChatRoots();
    panel.classList.toggle('vs-hidden', roots.length < 2);
    if (roots.length < 2) return;

    const scopeEl = $('chat-read-scope');
    const idxEl = $('chat-read-index');
    if (scopeEl) scopeEl.value = S.chatReadScope;
    if (idxEl) {
      idxEl.innerHTML = roots.map((_, i) =>
        `<option value="${i}"${S.chatReadIndex === i ? ' selected' : ''}>Reply ${i + 1} of ${roots.length}</option>`
      ).join('');
      idxEl.classList.toggle('vs-hidden', S.chatReadScope !== 'single');
      if (S.chatReadIndex >= roots.length) {
        S.chatReadIndex = roots.length - 1;
        idxEl.value = String(S.chatReadIndex);
      }
    }
  }

  function onChatReadScopeChange() {
    savePrefs();
    syncChatReadUI();
    if (S.words.length || document.querySelector('.vox-word')) {
      prepareAndRewrap(() => {
        if (S.speaking || S.paused) speakFrom(S.currentWord, S.speakEndIdx);
      });
    }
  }

  function syncPrintUI() {
    const btn = $('exp-pdf');
    if (!btn) return;
    btn.title = S.immersiveActive ? 'Print reader view' : 'Print this page';
  }

  // ── Audio export ───────────────────────────────────────────────────────────
  const MAX_EXPORT_WORDS = 2500;

  function getExportWordRange() {
    if (!S.words.length) return null;
    const maxEnd = S.words.length - 1;

    if (S.exportScope === 'selection') {
      const text = getSelectionText();
      if (!text) return null;
      const start = findWordIdxForText(text);
      if (start < 0) return null;
      const wc = text.trim().split(/\s+/).filter(Boolean).length;
      return { start, end: Math.min(start + wc - 1, maxEnd) };
    }

    if (S.exportScope === 'here') {
      const start = Math.min(Math.max(0, S.currentWord), maxEnd);
      const end = S.speakEndIdx != null ? Math.min(S.speakEndIdx, maxEnd) : maxEnd;
      return end >= start ? { start, end } : null;
    }

    return {
      start: 0,
      end: S.speakEndIdx != null ? Math.min(S.speakEndIdx, maxEnd) : maxEnd,
    };
  }

  function maybeRunPendingExport() {
    if (!S.pendingExport || S.exporting) return;
    S.pendingExport = false;
    exportAudio();
  }

  function runKokoroFileExport(startIdx, endIdx) {
    const sentences = getSentencesFrom(startIdx, endIdx);
    if (!sentences.length) {
      setStatus('Nothing to export');
      return;
    }
    S.exporting = true;
    const ext = S.exportFormat === 'mp3' ? 'mp3' : 'wav';
    const filename = `vox-reader-${S.kokoroVoice || 'kokoro'}.${ext}`;
    const label = ext.toUpperCase();
    setStatus(`Generating ${label}… 0%`, true);
    syncExportUI();
    sendMsg({
      action: 'kokoro_export',
      sentences,
      speed: S.speed,
      voice: S.kokoroVoice,
      filename,
      format: S.exportFormat,
      mp3Bitrate: S.exportBitrate,
    });
  }

  function cancelPendingExport() {
    const hadPending = S.pendingExport;
    if (S.kokoroLoading) {
      sendMsg({ action: 'kokoro_load_cancel' });
      S.kokoroLoading = false;
      S.kokoroDownloadPct = 0;
    }
    S.pendingExport = false;
    syncInstallUI();
    syncExportUI();
    if (hadPending) setStatus('Export cancelled');
    return hadPending;
  }

  function exportAudio() {
    if (S.pendingExport && !S.exporting) {
      cancelPendingExport();
      return;
    }

    const doExport = () => {
      const range = getExportWordRange();
      if (!range) {
        if (S.exportScope === 'selection') {
          setStatus(getSelectionText() ? 'Selection not found on page' : 'Select text on the page first');
        } else {
          setStatus('Nothing to export');
        }
        return;
      }

      let { start: startIdx, end: endIdx } = range;
      if (endIdx < startIdx) {
        setStatus('Nothing to export');
        return;
      }
      if (endIdx - startIdx + 1 > MAX_EXPORT_WORDS) {
        endIdx = startIdx + MAX_EXPORT_WORDS - 1;
        setStatus(`Export capped at ${MAX_EXPORT_WORDS} words`, true);
      }

      if (!S.kokoroModelCached) {
        if (S.exporting) return;
        S.pendingExport = true;
        if (!S.kokoroLoading) {
          setStatus('Downloading AI voice for export (one-time)…', true);
          startKokoroDownload();
        } else {
          setStatus('Will export when AI voice finishes downloading…', true);
        }
        syncExportUI();
        return;
      }

      if (S.exporting) return;
      if (S.speaking && !S.paused) {
        S.pendingExport = true;
        setStatus('Will export when playback finishes…', true);
        return;
      }
      if (S.speaking || S.paused) stop(false);
      runKokoroFileExport(startIdx, endIdx);
    };
    if (!S.words.length) { rewrap(doExport); return; }
    doExport();
  }

  function syncExportUI() {
    const btn = $('exp-mp3');
    const fmt = $('export-format');
    const scope = $('export-scope');
    const bitrate = $('export-bitrate');
    if (fmt) fmt.value = S.exportFormat;
    if (scope) scope.value = S.exportScope;
    if (bitrate) {
      bitrate.value = String(S.exportBitrate);
      bitrate.classList.toggle('vs-hidden', S.exportFormat !== 'mp3');
    }
    if (!btn) return;
    const canFile = S.kokoroModelCached;
    if (S.pendingExport && !S.exporting) {
      btn.textContent = 'Cancel';
      btn.title = S.kokoroLoading
        ? 'Cancel AI voice download and export'
        : 'Cancel queued export';
      btn.disabled = false;
    } else if (canFile) {
      const ext = S.exportFormat === 'mp3' ? 'MP3' : 'WAV';
      const scopeLabel = S.exportScope === 'selection' ? 'selection' : S.exportScope === 'here' ? 'from here' : 'full page';
      btn.textContent = 'Export';
      btn.title = `Download ${ext} (${scopeLabel})`;
      btn.disabled = S.exporting;
    } else {
      const ext = S.exportFormat === 'mp3' ? 'MP3' : 'WAV';
      btn.textContent = 'Export';
      btn.title = S.kokoroLoading
        ? 'Downloading AI voice for export…'
        : `Download ${ext} — one-time AI voice download on first export`;
      btn.disabled = S.exporting;
    }
    if (fmt) fmt.disabled = S.exporting && !S.pendingExport;
    if (scope) scope.disabled = S.exporting && !S.pendingExport;
    if (bitrate) {
      bitrate.disabled = (S.exporting && !S.pendingExport) || S.exportFormat !== 'mp3';
      bitrate.classList.toggle('vs-hidden', S.exportFormat !== 'mp3');
    }
  }

  // ── Kokoro UI helpers ──────────────────────────────────────────────────────
  function startKokoroDownload() {
    if (S.kokoroLoading || S.kokoroModelCached) return;
    S.kokoroLoading = true;
    S.kokoroDownloadPct = 0;
    syncEngineUI();
    syncInstallUI();
    setStatus('Downloading Kokoro model…', true);
    sendMsg({ action: 'kokoro_load', voice: S.kokoroVoice, device: S.kokoroDevice });
  }

  function syncInstallUI() {
    const panel = $('vox-kokoro-install');
    const playBtn = $('vox-playpause-bar');
    const cancelBtn = $('vox-install-cancel');
    if (!panel) return;
    const show = S.kokoroLoading || (S.voiceEngine === 'kokoro' && !S.kokoroModelCached);
    panel.classList.toggle('vs-hidden', !show);
    if (cancelBtn) cancelBtn.classList.toggle('vs-hidden', !S.kokoroLoading);
    if (playBtn) {
      const blocked = S.voiceEngine === 'kokoro' && !S.kokoroModelCached;
      playBtn.disabled = blocked;
      playBtn.title = blocked ? 'AI voice must finish downloading first' : '';
    }
    syncExportUI();
  }

  function cancelKokoroDownload() {
    if (!S.kokoroLoading) return;
    sendMsg({ action: 'kokoro_load_cancel' });
    S.kokoroLoading = false;
    S.kokoroDownloadPct = 0;
    S.pendingPlayAfterKokoro = false;
    const wasPendingExport = S.pendingExport;
    S.pendingExport = false;
    syncInstallUI();
    syncExportUI();
    setStatus(wasPendingExport ? 'Cancelling export…' : 'Cancelling download…');
  }

  function updateKokoroInstallProgress(pct, file, status) {
    S.kokoroDownloadPct = pct;
    const bar = $('vox-install-progress');
    const fileEl = $('vox-install-file');
    const statusEl = $('vox-install-status');
    if (bar) bar.value = Math.max(0, Math.min(100, pct));
    if (fileEl) fileEl.textContent = file || '';
    if (statusEl) {
      const initStatus = status || '';
      if (/initializ/i.test(initStatus)) {
        statusEl.textContent = initStatus;
      } else if (pct >= 99 && S.kokoroLoading) {
        statusEl.textContent = 'Finishing AI voice setup…';
      } else if (pct > 0) {
        statusEl.textContent = `Downloading AI voice… ${pct}%`;
      } else {
        statusEl.textContent = initStatus || 'Downloading AI voice (~86MB) — required once';
      }
    }
  }

  function populateKokoroVoices() {
    const sel = $('vox-kokoro-voice-select');
    if (!sel) return;
    sel.innerHTML = '';
    KOKORO_VOICES.forEach(v => {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.label;
      if (v.id === S.kokoroVoice) o.selected = true;
      sel.appendChild(o);
    });
    sel.disabled = !S.kokoroModelCached;
  }

  function setKokoroUIState(state) {
    const voiceSel = $('vox-kokoro-voice-select');
    if (!voiceSel) return;
    if (state === 'loading' || state === 'downloading') {
      voiceSel.disabled = true;
    } else if (state === 'ready') {
      voiceSel.disabled = false;
      populateKokoroVoices();
    } else if (state === 'error') {
      voiceSel.disabled = true;
    }
    syncInstallUI();
  }

  function syncEngineUI() {
    // Show/hide classic vs kokoro voice sections
    const classicSection = $('vox-classic-voice-section');
    const kokoroSection  = $('vox-kokoro-section');
    const engClassic = $('eng-classic');
    const engKokoro  = $('eng-kokoro');
    if (classicSection) classicSection.classList.toggle('vs-hidden', S.voiceEngine === 'kokoro');
    if (kokoroSection)  kokoroSection.classList.toggle('vs-hidden', S.voiceEngine === 'classic');
    if (engClassic) engClassic.classList.toggle('active', S.voiceEngine === 'classic');
    if (engKokoro)  engKokoro.classList.toggle('active', S.voiceEngine === 'kokoro');

    if (S.voiceEngine === 'kokoro') {
      // S.kokoroLoading reflects in-progress load this session; takes priority over cached flag
      setKokoroUIState(S.kokoroLoading || !S.kokoroModelCached ? 'loading' : 'ready');
    }
    syncVoicePill();
    syncExportUI();
  }

  // ── Player ─────────────────────────────────────────────────────────────────
  function createPlayer() {
    const existing = S.playerEl && S.playerEl.isConnected ? S.playerEl : null;
    if (existing) {
      existing.classList.remove('vox-hidden');
      bringPlayerToFront();
      populateVoices(); populateKokoroVoices(); syncEngineUI(); syncInstallUI(); syncExportUI(); syncPrintUI();
      applyAppearance();
      updateProgress();
      offerResume();
      return;
    }

    const { host } = window.VoxPlayerUI.mount(S);
    S.playerEl = host;
    bindEvents();
    loadVoices();
    populateKokoroVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    $('sc-play').value = S.shortcuts.play;
    $('sc-stop').value = S.shortcuts.stop;
    $('sc-read').value = S.shortcuts.read;
    $('sc-export').value = S.shortcuts.export;
    syncSpeedUI();
    startChatObserver();
    syncEngineUI();
    syncPrintUI();
    syncChatReadUI();
    applyAppearance();
    syncDeviceUI();
    updateProgress();
    offerResume();
    if (S.voiceEngine === 'kokoro' && !S.kokoroModelCached) {
      startKokoroDownload();
    } else {
      syncInstallUI();
    }
  }

  // Overlays such as Focus Reader's view use the same max z-index; the later
  // element in the DOM wins, so re-append the player above them.
  function bringPlayerToFront() {
    const host = S.playerEl;
    if (host && host.isConnected && host !== document.documentElement.lastElementChild) {
      document.documentElement.appendChild(host);
    }
  }

  // ── Popovers (speed, voice, settings) — one open at a time ──
  const POPOVERS = { speed: ['vox-speed-menu', 'vox-speed-pill'], voice: ['vox-voice-menu', 'vox-voice-pill'], settings: ['vox-settings', 'vox-settings-btn'] };

  function togglePopover(name, force) {
    for (const [key, [popId, btnId]] of Object.entries(POPOVERS)) {
      const open = key === name ? (force != null ? force : !$(popId)?.classList.contains('open')) : false;
      $(popId)?.classList.toggle('open', open);
      $(btnId)?.setAttribute('aria-expanded', String(open));
      if (key === 'settings') S.settingsOpen = open;
    }
    if (name === 'settings' && S.settingsOpen) syncChatReadUI();
  }

  function closePopovers() { togglePopover(null); }

  function syncSpeedUI() {
    const label = window.VoxPlayerUI.speedLabel(S.speed);
    const slider = $('vox-speed-slider');
    if (slider) slider.value = S.speed;
    if ($('vox-speed-val')) $('vox-speed-val').textContent = label;
    if ($('vox-speed-pill')) $('vox-speed-pill').textContent = label;
    S.playerEl?.shadowRoot?.querySelectorAll('.vox-speed-opt').forEach((b) => {
      b.setAttribute('aria-checked', String(Math.abs(parseFloat(b.dataset.speed) - S.speed) < 0.01));
    });
    updateProgress();
  }

  function setSpeed(v, { restart = true } = {}) {
    S.speed = Math.max(0.5, Math.min(3, Math.round(v * 100) / 100));
    syncSpeedUI();
    savePrefs();
    if (restart && (S.speaking || S.paused)) speakFrom(S.currentWord, S.speakEndIdx);
  }

  function syncVoicePill() {
    const pill = $('vox-voice-pill');
    if (!pill) return;
    let name;
    if (S.voiceEngine === 'kokoro') {
      const v = KOKORO_VOICES.find((x) => x.id === S.kokoroVoice);
      name = v ? v.label.split(' ')[0] : 'Bella';
    } else {
      name = (S.voice?.name || 'System').replace(/Microsoft|Google|Apple/gi, '').trim().split(/\s+/)[0];
    }
    pill.textContent = name;
    pill.title = S.voiceEngine === 'kokoro' ? `AI voice: ${name}` : `System voice: ${name}`;
  }

  function bindEvents() {
    $('vox-close-bar').onclick = () => { stop(false); closePopovers(); S.playerEl.classList.add('vox-hidden'); };

    let _capturedSel = null;
    $('vox-playpause-bar').addEventListener('mousedown', () => {
      const text = getSelectionText();
      _capturedSel = text ? { text } : null;
    });

    $('vox-playpause-bar').onclick = async () => {
      if (!S.speaking && !S.paused) {
        if (S.exporting) {
          S.playAfterExport = true;
          setStatus('Will play when export finishes…', true);
          return;
        }
        const captured = _capturedSel; _capturedSel = null;
        if (captured) {
          readSelection(captured.text).catch(() => {});
        } else if (!S.words.length || rootsNeedRewrap()) {
          await prepareAndRewrap(() => speakFrom(findFirstVisibleWordIdx()));
        } else {
          const startIdx = S.currentWord === 0 ? findFirstVisibleWordIdx() : S.currentWord;
          speakFrom(startIdx);
        }
      } else { pauseResume(); }
    };

    $('vox-back-bar').onclick = skipBack;
    $('vox-fwd-bar').onclick = skipFwd;
    $('vox-immersive-btn').onclick = toggleImmersive;

    // Speed menu
    $('vox-speed-pill').onclick = () => togglePopover('speed');
    S.playerEl.shadowRoot.querySelectorAll('.vox-speed-opt').forEach((b) => {
      b.onclick = () => setSpeed(parseFloat(b.dataset.speed));
    });
    const speedSlider = $('vox-speed-slider');
    speedSlider.oninput = (e) => {
      S.speed = parseFloat(e.target.value);
      syncSpeedUI();
    };
    speedSlider.onchange = (e) => setSpeed(parseFloat(e.target.value));

    // Voice menu
    $('vox-voice-pill').onclick = () => togglePopover('voice');
    $('vox-settings-btn').onclick = () => togglePopover('settings');
    $('vox-settings-close').onclick = () => togglePopover('settings', false);

    // Clicks outside the player close its popovers; Escape too.
    document.addEventListener('mousedown', (e) => {
      if (!S.playerEl || e.composedPath().includes(S.playerEl)) return;
      closePopovers();
    }, true);
    S.playerEl.shadowRoot.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePopovers(); e.stopPropagation(); }
    });

    // Classic voice select
    $('vox-voice-select').onchange = (e) => {
      const v = window.speechSynthesis.getVoices().find(v => v.name === e.target.value);
      if (v) {
        S.voice = v; S.selectedVoiceName = v.name; savePrefs(); syncVoicePill();
        if (S.speaking) { const i = S.currentWord; stop(false); speakFrom(i); }
      }
    };

    // Voice engine toggle
    $('eng-classic').onclick = () => {
      if (S.voiceEngine === 'classic') return;
      stop(false);
      S.pendingPlayAfterKokoro = false;
      S.voiceEngine = 'classic'; savePrefs(); syncEngineUI();
      $('eng-classic').setAttribute('aria-pressed', 'true');
      $('eng-kokoro').setAttribute('aria-pressed', 'false');
    };
    $('eng-kokoro').onclick = () => {
      if (S.voiceEngine === 'kokoro') return;
      stop(false);
      S.voiceEngine = 'kokoro';
      savePrefs();
      syncEngineUI();
      $('eng-classic').setAttribute('aria-pressed', 'false');
      $('eng-kokoro').setAttribute('aria-pressed', 'true');
      if (!S.kokoroModelCached) startKokoroDownload();
      else { setKokoroUIState('ready'); setStatus('AI voice ready — press Play', true); }
    };

    $('vox-kokoro-voice-select').onchange = (e) => {
      S.kokoroVoice = e.target.value;
      savePrefs();
      syncVoicePill();
      if (S.kokoroModelCached) {
        sendMsg({ action: 'kokoro_warm_voice', voice: S.kokoroVoice });
        if (S.speaking || S.paused) speakFrom(S.currentWord);
      }
    };

    // Progress bar (scrubber)
    const prog = $('vox-progress');
    prog.oninput = () => {
      S.scrubbing = true;
      prog.style.setProperty('--pct', (prog.value / 10) + '%');
    };
    prog.onchange = (e) => {
      if (!S.words.length) return;
      S.scrubbing = false;
      let idx = Math.floor((e.target.value / 1000) * (S.words.length - 1));
      // During a bounded read (selection), keep the scrub inside the read range
      if ((S.speaking || S.paused) && S.speakEndIdx != null && idx > S.speakEndIdx) {
        idx = S.speakEndIdx;
      }
      S.currentWord = idx;
      highlightAt(idx);
      if (S.speaking || S.paused) speakFrom(idx);
    };

    bindAppearanceControls();
    $('vox-resume-yes').onclick = resumeFromSaved;
    $('vox-resume-no').onclick = startOver;
    $('vox-back-to-reading').onclick = backToReading;
    $('hl-bg').onclick = () => {
      S.sentenceStyle = 'bg';
      $('hl-bg').classList.add('active');
      $('hl-bg').setAttribute('aria-pressed','true');
      $('hl-ul').classList.remove('active');
      $('hl-ul').setAttribute('aria-pressed','false');
      applyColors(); savePrefs();
    };
    $('hl-ul').onclick = () => {
      S.sentenceStyle = 'underline';
      $('hl-ul').classList.add('active');
      $('hl-ul').setAttribute('aria-pressed','true');
      $('hl-bg').classList.remove('active');
      $('hl-bg').setAttribute('aria-pressed','false');
      applyColors(); savePrefs();
    };

    function bindHex(inputId, setter) {
      const el = $(inputId);
      el.oninput = (e) => {
        let val = e.target.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
          el.style.borderColor = val;
          setter(val);
          applyColors(); savePrefs();
        }
      };
    }
    bindHex('hex-word', v => S.wordColor = v);
    bindHex('hex-sentence', v => S.sentenceHex = v);

    $('sc-save').onclick = () => {
      S.shortcuts.play = $('sc-play').value || 'p';
      S.shortcuts.stop = $('sc-stop').value || 's';
      S.shortcuts.read = $('sc-read').value || 'r';
      S.shortcuts.export = $('sc-export').value || 'e';
      savePrefs(); setStatus('Saved!');
    };

    $('exp-pdf').onclick = () => printReadable();
    $('exp-mp3').onclick = exportAudio;
    $('vox-install-cancel')?.addEventListener('click', cancelKokoroDownload);
    $('export-format').onchange = (e) => {
      S.exportFormat = e.target.value === 'wav' ? 'wav' : 'mp3';
      savePrefs();
      syncExportUI();
    };
    $('export-scope').onchange = (e) => {
      const v = e.target.value;
      S.exportScope = (v === 'selection' || v === 'here') ? v : 'all';
      savePrefs();
      syncExportUI();
    };
    $('export-bitrate').onchange = (e) => {
      const n = parseInt(e.target.value, 10);
      S.exportBitrate = [96, 128, 192].includes(n) ? n : 128;
      savePrefs();
    };
    $('chat-read-scope').onchange = (e) => {
      const v = e.target.value;
      S.chatReadScope = (v === 'latest' || v === 'single') ? v : 'all';
      onChatReadScopeChange();
    };
    $('chat-read-index').onchange = (e) => {
      S.chatReadIndex = Math.max(0, parseInt(e.target.value, 10) || 0);
      onChatReadScopeChange();
    };

    // Click-to-jump (only while speaking/paused). composedPath() reaches words
    // inside open shadow roots (e.g. Focus Reader's view).
    document.addEventListener('click', (e) => {
      if (!S.speaking && !S.paused) return;
      const target = e.composedPath()[0];
      const sp = target?.closest?.('.vox-word');
      if (!sp || sp.dataset.voxIndex == null) return;
      const idx = parseInt(sp.dataset.voxIndex, 10);
      if (S.speakEndIdx != null && idx > S.speakEndIdx) return;
      speakFrom(idx, S.speakEndIdx);
    }, true);
  }

  function updatePlayBtn() {
    const btn = $('vox-playpause-bar');
    if (!btn) return;
    const playing = S.speaking && !S.paused;
    btn.innerHTML = playing ? window.VoxPlayerUI.ICON.pause : window.VoxPlayerUI.ICON.play;
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    syncInstallUI();
  }

  function setStatus(text, active = false) {
    const el = $('vox-status');
    if (el) { el.textContent = text; el.className = active ? 'playing' : ''; }
  }

  function spokenOf(w) {
    if (!w) return '';
    return w.spoken != null ? w.spoken : w.text;
  }

  // Prefix sums of spoken characters, rebuilt whenever the word list changes.
  function rebuildCharIndex() {
    const pre = new Array(S.words.length + 1);
    pre[0] = 0;
    for (let i = 0; i < S.words.length; i++) {
      const sp = spokenOf(S.words[i]);
      pre[i + 1] = pre[i] + (sp ? sp.length + 1 : 0);
    }
    S.charPrefix = pre;
  }

  function updateTimeLeft() {
    const el = $('vox-time-left');
    if (!el) return;
    if (!S.words.length) {
      // Not wrapped yet: estimate the whole readable text so the bar is useful before Play.
      const chars = rootsTextLength(getReadableRoots());
      el.textContent = chars > 40 ? window.VoxPlayback.formatTimeLeft(window.VoxPlayback.secondsLeft(chars, S.speed)) : '';
      return;
    }
    if (!S.charPrefix || S.charPrefix.length !== S.words.length + 1) rebuildCharIndex();
    const end = (S.speakEndIdx != null ? S.speakEndIdx : S.words.length - 1) + 1;
    const from = Math.min(Math.max(0, S.currentWord), end);
    const chars = S.charPrefix[end] - S.charPrefix[from];
    const cps = S.voiceEngine === 'kokoro' && S.measuredCps ? S.measuredCps : window.VoxPlayback.BASE_CPS;
    const secs = window.VoxPlayback.secondsLeft(chars, S.speed) * (window.VoxPlayback.BASE_CPS / cps);
    el.textContent = window.VoxPlayback.formatTimeLeft(secs);
  }

  function updateProgress() {
    const el = $('vox-progress');
    if (!el) return;
    if (!S.scrubbing && S.words.length >= 1) {
      const denom = Math.max(1, S.words.length - 1);
      const frac = Math.min(1, Math.max(0, S.currentWord / denom));
      el.value = Math.floor(frac * 1000);
      el.style.setProperty('--pct', (frac * 100).toFixed(1) + '%');
      el.setAttribute('aria-valuenow', Math.round(frac * 100));
      el.setAttribute('aria-valuetext', `${Math.round(frac * 100)}%`);
    }
    updateTimeLeft();
    if (S.speaking && !S.paused) savePosition(false);
  }

  // ── Segmented settings: highlight mode + appearance ──────────────────────
  function bindSeg(id, onPick) {
    const group = $(id);
    if (!group) return;
    group.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        onPick(b.dataset.value);
      };
    });
  }

  function bindAppearanceControls() {
    bindSeg('hl-mode', (v) => {
      setHighlightMode(v);
      savePrefs();
      if (S.speaking || S.paused) {
        clearHL();
        S.currentSentence = -1;
        highlightAt(S.currentWord);
      }
    });
    bindSeg('theme-seg', (v) => { S.theme = v; applyAppearance(); savePrefs(); });
    bindSeg('device-seg', (v) => {
      S.kokoroDevice = v === 'wasm' ? 'wasm' : 'auto';
      savePrefs();
      syncDeviceUI();
      if (S.voiceEngine === 'kokoro' && S.kokoroModelCached && !S.speaking) {
        setStatus('Switching AI voice engine…', true);
        sendMsg({ action: 'kokoro_load', voice: S.kokoroVoice, device: S.kokoroDevice });
      }
    });
    bindSeg('font-seg', (v) => { S.readerFont = v; applyAppearance(); savePrefs(); });
    bindSeg('width-seg', (v) => { S.readerWidth = v; applyAppearance(); savePrefs(); });
    bindSeg('line-seg', (v) => { S.readerLine = v; applyAppearance(); savePrefs(); });
    const size = (d) => { S.readerSize = Math.min(30, Math.max(14, S.readerSize + d)); applyAppearance(); savePrefs(); };
    $('size-down').onclick = () => size(-1);
    $('size-up').onclick = () => size(1);
  }

  function syncDeviceUI() {
    const note = $('vox-device-note');
    if (!note) return;
    const using = S.kokoroBackend === 'webgpu' ? 'Using GPU (WebGPU).' : S.kokoroBackend === 'wasm' ? 'Using CPU.' : '';
    note.textContent = S.kokoroDevice === 'wasm'
      ? `CPU only: ~86 MB model, slower than real time on some machines. ${using}`
      : `GPU when available (~330 MB model, much faster), CPU otherwise. ${using}`;
  }

  const READER_WIDTHS = { narrow: '560px', medium: '680px', wide: '860px' };

  /** Theme on the player host; theme + typography on the immersive reader. */
  function applyAppearance() {
    if (S.playerEl) S.playerEl.dataset.theme = S.theme;
    const sv = $('size-val');
    if (sv) sv.textContent = `${S.readerSize}px`;
    const ov = S.immersiveOverlay;
    if (!ov) return;
    ov.dataset.theme = S.theme;
    ov.style.setProperty('--vox-r-font', S.readerFont === 'sans'
      ? "-apple-system, 'Segoe UI', system-ui, sans-serif"
      : "Georgia, 'Times New Roman', serif");
    ov.style.setProperty('--vox-r-size', `${S.readerSize}px`);
    ov.style.setProperty('--vox-r-width', READER_WIDTHS[S.readerWidth] || READER_WIDTHS.medium);
    ov.style.setProperty('--vox-r-line', S.readerLine);
  }

  // ── Per-page reading position (content/lib/positions.js) ──────────────────
  const POS_KEY = window.VoxPositions.POSITIONS_KEY;
  let _posSavedAt = 0;
  let _resumeEntry = null;

  function currentPageKey() { return window.VoxPositions.pageKey(location.href); }

  function savePosition(force) {
    if (!S.trackPosition || !S.words.length) return;
    const now = Date.now();
    if (!force && now - _posSavedAt < 3000) return;
    _posSavedAt = now;
    const idx = Math.min(S.currentWord, S.words.length - 1);
    const anchor = S.words.slice(idx, idx + 6).map((w) => w.text).join(' ');
    const entry = window.VoxPositions.makeEntry(idx, S.words.length, anchor);
    try {
      chrome.storage.local.get(POS_KEY, (r) => {
        const map = window.VoxPositions.upsertPosition(r?.[POS_KEY], currentPageKey(), entry);
        chrome.storage.local.set({ [POS_KEY]: map });
      });
    } catch (_) { /* extension reloaded */ }
  }

  function clearPosition() {
    try {
      chrome.storage.local.get(POS_KEY, (r) => {
        if (!r?.[POS_KEY]?.[currentPageKey()]) return;
        chrome.storage.local.set({ [POS_KEY]: window.VoxPositions.removePosition(r[POS_KEY], currentPageKey()) });
      });
    } catch (_) {}
  }

  function hideResume() {
    $('vox-resume')?.classList.add('vs-hidden');
  }

  function offerResume() {
    if (S.speaking || S.paused || getFocusReaderShadow()) return;
    try {
      chrome.storage.local.get(POS_KEY, (r) => {
        const entry = r?.[POS_KEY]?.[currentPageKey()];
        if (!window.VoxPositions.shouldOfferResume(entry) || S.speaking || S.paused) return;
        _resumeEntry = entry;
        $('vox-resume-text').textContent = `Resume from ${Math.round(entry.pct * 100)}%?`;
        $('vox-resume').classList.remove('vs-hidden');
      });
    } catch (_) {}
  }

  function resumeFromSaved() {
    const entry = _resumeEntry;
    hideResume();
    if (!entry) return;
    prepareAndRewrap(() => {
      let idx = window.VoxPositions.wordFromEntry(entry, S.words.length);
      if (entry.anchor) {
        const found = findWordIdxForText(entry.anchor, Math.max(0, idx - 200));
        if (found >= 0) idx = found;
      }
      S.followPaused = false;
      speakFrom(idx);
    });
  }

  function startOver() {
    hideResume();
    clearPosition();
    prepareAndRewrap(() => { S.followPaused = false; speakFrom(0); });
  }

  // ── Keyboard while reading (no modifiers, never while typing) ──────────────
  function isTypingTarget(e) {
    const t = e.composedPath()[0];
    if (!t || t.nodeType !== 1) return false;
    if (t.isContentEditable) return true;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  }

  function stepSpeed(dir) {
    const list = window.VoxPlayerUI.SPEEDS;
    let next = S.speed;
    if (dir > 0) next = list.find((v) => v > S.speed + 0.001) ?? list[list.length - 1];
    else next = [...list].reverse().find((v) => v < S.speed - 0.001) ?? list[0];
    setSpeed(next);
    setStatus(`Speed ${window.VoxPlayerUI.speedLabel(next)}`, true);
  }

  document.addEventListener('keydown', (e) => {
    if (!S.speaking && !S.paused) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    if (isTypingTarget(e)) return;
    const t = e.composedPath()[0];
    if (e.key === ' ' && t?.tagName === 'BUTTON') return; // let the focused button click
    switch (e.key) {
      case ' ': pauseResume(); break;
      case 'ArrowLeft': skipBack(); break;
      case 'ArrowRight': skipFwd(); break;
      case '[': case '-': case '_': stepSpeed(-1); break;
      case ']': case '+': case '=': stepSpeed(1); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // ── "Back to reading" pill ────────────────────────────────────────────────
  // Manual scrolling while reading pauses auto-follow; the pill brings it back.
  let _pillRaf = 0;
  function currentWordEl() {
    const el = S.words[S.currentWord]?.el;
    return el && el.isConnected ? el : null;
  }
  function wordOffscreen(el) {
    const r = el.getBoundingClientRect();
    return r.bottom < 0 || r.top > window.innerHeight - 110;
  }
  function updateBackPill() {
    _pillRaf = 0;
    const pill = $('vox-back-to-reading');
    if (!pill) return;
    const el = (S.speaking || S.paused) ? currentWordEl() : null;
    const off = !!el && wordOffscreen(el);
    if (el && !off) S.followPaused = false;
    pill.classList.toggle('vs-hidden', !off);
  }
  function scheduleBackPill() {
    if (!_pillRaf) _pillRaf = requestAnimationFrame(updateBackPill);
  }
  function onUserScrollIntent() {
    if (S.speaking || S.paused) { S.followPaused = true; scheduleBackPill(); }
  }
  window.addEventListener('wheel', onUserScrollIntent, { capture: true, passive: true });
  window.addEventListener('touchmove', onUserScrollIntent, { capture: true, passive: true });
  window.addEventListener('keydown', (e) => {
    if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key) && !isTypingTarget(e)) onUserScrollIntent();
  }, true);
  document.addEventListener('scroll', scheduleBackPill, true);
  let _focusScrollBound = null;
  function watchForeignScroll() {
    const fr = getFocusReaderShadow();
    if (fr && _focusScrollBound !== fr) {
      fr.addEventListener('scroll', scheduleBackPill, true);
      _focusScrollBound = fr;
    }
  }
  function backToReading() {
    S.followPaused = false;
    const el = currentWordEl();
    if (el) scrollWordIntoView(el);
    $('vox-back-to-reading')?.classList.add('vs-hidden');
  }

  // ── Text handed over by another extension (chrome.runtime.onMessageExternal) ──
  function wordsMatchAt(i, parts) {
    const norm = (x) => x.replace(/\W/g, '').toLowerCase();
    const n = Math.min(parts.length, 12);
    if (i < 0 || i + n > S.words.length) return false;
    for (let j = 0; j < n; j++) if (norm(S.words[i + j].text) !== norm(parts[j])) return false;
    return true;
  }

  async function readExternalText(text, title) {
    const parts = String(text || '').split(/\s+/).filter(Boolean);
    if (!parts.length) return;
    stop(false);
    hideResume();
    // Prefer highlighting the text where it is shown (page or Focus Reader view).
    let found = -1;
    await prepareAndRewrap(() => {
      const idx = S.words.length ? findWordIdxForText(parts.slice(0, 8).join(' ')) : -1;
      if (wordsMatchAt(idx, parts)) found = idx;
    });
    S.readTitle = title || '';
    if (found >= 0) {
      setStatus('Reading…', true);
      speakFrom(found, Math.min(found + parts.length - 1, S.words.length - 1));
      return;
    }
    // Not on the page: read it with the player, without in-page highlighting.
    unwrap();
    S.words = parts.map((t) => ({ text: t, el: null }));
    buildSentences();
    setStatus('Reading shared text…', true);
    speakFrom(0, S.words.length - 1);
  }

  // ── Message + keyboard ─────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'toggle_player') {
      ensurePlayerReady();
      return;
    }

    if (msg.action === 'read_selection') {
      ensurePlayerReady(() => {
        readSelection(msg.text).catch(() => {});
      });
      return;
    }

    if (msg.action === 'command_play_pause') {
      ensurePlayerReady(() => {
        if (!S.speaking && !S.paused) $('vox-playpause-bar')?.click();
        else pauseResume();
      });
      return;
    }

    if (msg.action === 'command_stop') {
      stop(true);
      return;
    }

    if (msg.action === 'command_export') {
      ensurePlayerReady(() => { exportAudio(); });
      return;
    }

    if (msg.action === 'kokoro_interrupted') {
      stopTicker(); clearHL();
      S.speaking = false; S.paused = false;
      document.documentElement.classList.remove('vox-reading');
      updatePlayBtn();
      setStatus('Stopped — playback in another tab');
      return;
    }

    // Kokoro responses from offscreen (routed through SW)
    if (msg.action === 'kokoro_chunk') {
      onKokoroChunk(msg);
      return;
    }

    if (msg.action === 'kokoro_offscreen_lost') {
      // The browser closed the offscreen document mid-read: pick up at the current sentence.
      S.kokoroBackend = '';
      if (S.voiceEngine !== 'kokoro' || !S.speaking || S.paused) return;
      const si = getSentenceIdx(S.currentWord);
      const from = si >= 0 ? Math.max(S.sentences[si].start, S.speakStartIdx ?? 0) : S.currentWord;
      setStatus('Reconnecting AI voice…', true);
      S.currentWord = from;
      speakFrom(from, S.speakEndIdx);
      return;
    }

    if (msg.action === 'kokoro_resume_failed') {
      // Offscreen doc was recycled during a long pause: restart at the current sentence.
      if (!S.speaking || S.paused || S.voiceEngine !== 'kokoro') return;
      const si = getSentenceIdx(S.currentWord);
      const from = si >= 0 ? Math.max(S.sentences[si].start, S.speakStartIdx ?? 0) : S.currentWord;
      S.currentWord = from;
      speakFrom(from, S.speakEndIdx);
      return;
    }

    if (msg.action === 'kokoro_media') {
      // Media keys / Now Playing controls, routed from the offscreen document.
      if (msg.key === 'play' && S.paused) pauseResume();
      else if (msg.key === 'pause' && S.speaking && !S.paused) pauseResume();
      else if (msg.key === 'next') skipFwd();
      else if (msg.key === 'prev') skipBack();
      else if (msg.key === 'stop') stop(false);
      return;
    }

    if (msg.action === 'vox_read_text') {
      ensurePlayerReady(() => { readExternalText(msg.text, msg.title).catch(() => {}); });
      return;
    }

    if (msg.action === 'kokoro_end') {
      if (msg.session != null && msg.session !== S.kokoroSession) return;
      const finishedWholePage = S.trackPosition && S.speakEndIdx == null;
      stopTicker(); clearHL(); clearChunkTimers();
      clearIframeHighlights();
      if (finishedWholePage) clearPosition();
      S.lastKokoroChunk = null;
      S.speaking = false; S.paused = false; S.speakEndIdx = null; S.speakStartIdx = null;
      document.documentElement.classList.remove('vox-reading');
      updatePlayBtn(); setStatus('Done'); S.currentWord = 0;
      maybeRunPendingExport();
      return;
    }

    if (msg.action === 'kokoro_ready') {
      if (msg.backend) S.kokoroBackend = msg.backend;
      syncDeviceUI();
      S.kokoroModelCached = true; S.kokoroLoading = false;
      S.kokoroDownloadPct = 100;
      saveKokoroFlag();
      syncExportUI();
      syncInstallUI();
      if (S.voiceEngine === 'kokoro') {
        setKokoroUIState('ready');
        updateKokoroInstallProgress(100, '', 'AI voice ready');
        if (S.pendingPlayAfterKokoro && S.pendingExport) {
          // Both Play and Export queued on this download — export wins,
          // playback starts when the export finishes (playAfterExport).
          S.pendingPlayAfterKokoro = false;
          S.playAfterExport = true;
          setStatus('AI voice ready — starting export…', true);
        } else if (S.pendingPlayAfterKokoro) {
          S.pendingPlayAfterKokoro = false;
          const idx = S.pendingPlayStartIdx;
          setStatus('AI voice ready — starting…', true);
          setTimeout(() => {
            if (S.voiceEngine !== 'kokoro' || !S.kokoroModelCached) return;
            if (!S.words.length || rootsNeedRewrap()) {
              prepareAndRewrap(() => speakFrom(idx >= 0 ? idx : findFirstVisibleWordIdx())).catch(() => {});
            } else {
              speakFrom(idx >= 0 ? idx : findFirstVisibleWordIdx());
            }
          }, 150);
        } else {
          setStatus('AI voice ready — press Play', true);
        }
      } else if (S.pendingExport) {
        setStatus('AI voice ready — starting export…', true);
      }
      maybeRunPendingExport();
      return;
    }

    if (msg.action === 'kokoro_progress') {
      if (S.kokoroLoading) {
        updateKokoroInstallProgress(msg.pct || 0, msg.file, msg.status);
      }
      if (S.pendingExport) {
        setStatus(`Downloading for export… ${msg.pct || 0}%`, true);
      } else if (S.voiceEngine === 'kokoro' && S.kokoroLoading) {
        setStatus(`Downloading Kokoro model… ${msg.pct || 0}%`, true);
      }
      return;
    }

    if (msg.action === 'kokoro_load_cancelled') {
      S.kokoroLoading = false;
      S.kokoroDownloadPct = 0;
      S.pendingPlayAfterKokoro = false;
      const wasPendingExport = S.pendingExport;
      S.pendingExport = false;
      syncInstallUI();
      syncExportUI();
      if (S.voiceEngine === 'kokoro' && !S.kokoroModelCached) {
        setKokoroUIState('error');
      }
      // A cancelled load can report back after the user already started
      // something else (e.g. switched to Classic and pressed Play).
      if (S.speaking) return;
      setStatus(wasPendingExport ? 'Export cancelled' : 'Download cancelled');
      return;
    }

    if (msg.action === 'kokoro_export_progress') {
      if (S.exporting) {
        const label = S.exportFormat === 'mp3' ? 'MP3' : 'WAV';
        setStatus(`Generating ${label}… ${msg.pct || 0}%`, true);
      }
      return;
    }

    if (msg.action === 'kokoro_export_done') {
      S.exporting = false;
      syncExportUI();
      setStatus(`Saved ${msg.filename || 'export.wav'}`);
      if (S.playAfterExport) {
        S.playAfterExport = false;
        setTimeout(() => $('vox-playpause-bar')?.click(), 150);
      }
      return;
    }

    if (msg.action === 'kokoro_export_error') {
      S.exporting = false;
      S.playAfterExport = false;
      syncExportUI();
      const cancelled = /cancel/i.test(msg.error || '');
      setStatus(cancelled ? 'Export cancelled' : 'Export error: ' + (msg.error || 'unknown'));
      return;
    }

    if (msg.action === 'kokoro_error') {
      const wasLoading = S.kokoroLoading;
      const wasPendingExport = S.pendingExport;
      S.kokoroLoading = false;
      S.pendingExport = false;
      S.pendingPlayAfterKokoro = false;
      if (wasLoading) invalidateKokoroCache();
      syncInstallUI();
      syncExportUI();
      if (S.voiceEngine === 'kokoro') {
        S.speaking = false;
        stopTicker(); clearHL();
        document.documentElement.classList.remove('vox-reading');
        updatePlayBtn();
        setStatus('Error: ' + (msg.error || 'unknown'));
        setKokoroUIState(S.kokoroModelCached ? 'ready' : 'error');
      } else if (wasPendingExport) {
        setStatus('Export error: ' + (msg.error || 'unknown'));
      }
      return;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    if (shortcutKeyMatches(e, S.shortcuts.play)) {
      e.preventDefault();
      ensurePlayerReady(() => {
        if (!S.speaking && !S.paused) $('vox-playpause-bar')?.click();
        else pauseResume();
      });
    }
    if (shortcutKeyMatches(e, S.shortcuts.stop)) {
      e.preventDefault();
      stop(true);
    }
    if (shortcutKeyMatches(e, S.shortcuts.read)) {
      e.preventDefault();
      const text = getSelectionText();
      if (text) ensurePlayerReady(() => { readSelection(text).catch(() => {}); });
    }
    if (shortcutKeyMatches(e, S.shortcuts.export)) {
      e.preventDefault();
      ensurePlayerReady(() => { exportAudio(); });
    }
  });

  document.addEventListener('scroll', () => {
    if (!S.speaking) return;
    scheduleOverlayRefresh();
  }, true);
  window.addEventListener('resize', () => scheduleOverlayRefresh(), true);

})();
