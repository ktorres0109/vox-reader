// Vox Reader v3 — content script

(function () {
  const IFRAME_SEL_MSG = 'vox-reader-iframe-selection';
  const IFRAME_READ_MSG = 'vox-reader-iframe-read';
  const IFRAME_READ_OK = 'vox-reader-iframe-read-ready';
  const IFRAME_HL_MSG = 'vox-reader-iframe-highlight';
  const IFRAME_CLEAR_MSG = 'vox-reader-iframe-clear';
  const IFRAME_INIT_MSG = 'vox-reader-iframe-init';
  const IFRAME_COMMAND_MSG = 'vox-reader-iframe-command';
  const isTopFrame = window.self === window.top;

  // Child frames: selection bridge + local wrap/highlight for cross-origin reads.
  if (!isTopFrame) {
    if (window.__voxReaderFrameBridge) return;
    window.__voxReaderFrameBridge = true;

    const frameWords = [];
    const frameSentences = [];
    let bridgeNonce = null;

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
      frameSentences.push(...VoxCore.buildSentences(frameWords.map((word) => word.text)));
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
        if (bridgeNonce) {
          window.top.postMessage({ source: IFRAME_SEL_MSG, text, nonce: bridgeNonce }, '*');
        }
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
      if (!d?.source || ev.source !== window.top) return;
      if (d.source === IFRAME_INIT_MSG && typeof d.nonce === 'string') {
        bridgeNonce = d.nonce;
        publishFrameSelection();
        return;
      }
      if (!bridgeNonce || d.nonce !== bridgeNonce) return;
      if (d.source === IFRAME_READ_MSG) {
        applyFrameTheme(d);
        let range = null;
        try {
          const sel = window.getSelection();
          if (sel?.rangeCount && !sel.isCollapsed &&
              (!d.text || normText(sel.toString()) === normText(d.text))) {
            range = sel.getRangeAt(0).cloneRange();
          } else if (d.text) {
            range = findRangeForText(d.text);
          }
        } catch (_) {}
        const ok = range ? wrapFrameRange(range) : false;
        if (ok) buildFrameSentences();
        try {
          window.top.postMessage({
            source: IFRAME_READ_OK,
            nonce: bridgeNonce,
            requestId: d.requestId,
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
    document.addEventListener('keydown', (event) => {
      if (!bridgeNonce || !event.altKey) return;
      const commandByKey = { p: 'play', s: 'stop', r: 'read', e: 'export' };
      const command = commandByKey[event.key.toLowerCase()];
      if (!command) return;
      event.preventDefault();
      window.top.postMessage({
        source: IFRAME_COMMAND_MSG,
        nonce: bridgeNonce,
        command,
      }, '*');
    });
    publishFrameSelection();
    return;
  }

  if (window.__voxReaderLoaded) return;
  window.__voxReaderLoaded = true;
  document.documentElement.dataset.voxReaderLoaded = 'true';

  const iframeBridgeNonce = crypto.randomUUID();

  // chrome.runtime.sendMessage throws synchronously when extension context is invalidated
  // (e.g. after extension reload). Wrapping in try-catch prevents uncaught errors and
  // ensures callers don't abort mid-function when the throw would skip later statements.
  function sendMsg(msg) {
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (_) {}
  }

  // Stop TTS on any navigation — refresh, back/forward, or SPA route change
  function stopTTS() {
    if (S.voiceEngine === 'kokoro') {
      sendMsg({ action: 'kokoro_stop', playbackId: S.kokoroPlaybackId });
    } else {
      window.speechSynthesis.cancel();
    }
  }

  function handleNavigation() {
    invalidatePlaybackIntent();
    if (S.speaking || S.paused) stop(false);
    else { stopTTS(); stopTicker(); clearHL(); }
    if (!S.immersiveActive && document.querySelector('.vox-word')) unwrap();
    if (S.immersiveActive) exitImmersive();
  }

  window.addEventListener('beforeunload', () => stopTTS());
  window.addEventListener('pagehide',     () => stopTTS());

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
    pendingPlayIntent: 0,
    playAfterExportIntent: 0,
    kokoroPlaybackId: 0,
    kreaderSync: false,
    chatDomDirty: false,          // chat DOM changed since last wrap
    chatReadScope: 'all',         // all | latest | single (chat sites)
    chatReadIndex: 0,
    iframeReadActive: false,
    speakEndIdx: null,            // when set, stop reading at this word index
    lastKokoroChunk: null,        // { sent, highlightStart, duration, startedAt } for ticker resume
    _voxDomUpdate: false,         // true while wrap/unwrap mutates the page
  };

  let frameSelection = { text: '', at: 0, source: null };
  const FRAME_SEL_TTL_MS = 5000;
  let playbackIntentGen = 0;
  let pendingAutoPlayTimer = null;

  function beginPlaybackIntent() {
    return ++playbackIntentGen;
  }

  function invalidatePlaybackIntent() {
    playbackIntentGen++;
    S.pendingPlayAfterKokoro = false;
    S.playAfterExport = false;
    if (pendingAutoPlayTimer) {
      clearTimeout(pendingAutoPlayTimer);
      pendingAutoPlayTimer = null;
    }
  }

  function isPlaybackIntentCurrent(intent) {
    return intent === playbackIntentGen;
  }

  function isKnownIframeWindow(source) {
    return Array.from(document.querySelectorAll('iframe'))
      .some((frame) => frame.contentWindow === source);
  }

  window.addEventListener('message', (ev) => {
    if (!ev.data || !isKnownIframeWindow(ev.source)) return;
    if (ev.data.nonce !== iframeBridgeNonce) return;
    if (ev.data.source === IFRAME_SEL_MSG) {
      if (typeof ev.data.text !== 'string') return;
      frameSelection = { text: ev.data.text.trim(), at: Date.now(), source: ev.source };
      return;
    }
    if (ev.data.source === IFRAME_COMMAND_MSG) {
      if (ev.data.command === 'play') {
        ensurePlayerReady(() => {
          if (!S.speaking && !S.paused) document.getElementById('vox-playpause-bar')?.click();
          else pauseResume();
        });
      } else if (ev.data.command === 'stop') {
        stop(true);
      } else if (ev.data.command === 'read') {
        ensurePlayerReady(() => readSelection().catch(() => {}));
      } else if (ev.data.command === 'export') {
        ensurePlayerReady(() => exportAudio());
      }
    }
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

  // ── Prefs ──────────────────────────────────────────────────────────────────
  function loadPrefs(cb) {
    chrome.storage.sync.get([
      'speed','voiceName','shortcuts','highlightWord','highlightSentence',
      'sentenceStyle','wordColor','sentenceHex',
      'voiceEngine','kokoroVoice','kreaderSync','exportFormat','exportScope','exportBitrate',
      'chatReadScope','chatReadIndex',
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
      if (p.kreaderSync != null) S.kreaderSync = !!p.kreaderSync;
      if (p.exportFormat === 'wav' || p.exportFormat === 'mp3') S.exportFormat = p.exportFormat;
      if (p.exportScope === 'all' || p.exportScope === 'selection' || p.exportScope === 'here') {
        S.exportScope = p.exportScope;
      }
      if ([96, 128, 192].includes(p.exportBitrate)) S.exportBitrate = p.exportBitrate;
      S.chatReadScope = (p.chatReadScope === 'latest' || p.chatReadScope === 'single') ? p.chatReadScope : 'all';
      if (typeof p.chatReadIndex === 'number' && p.chatReadIndex >= 0) S.chatReadIndex = p.chatReadIndex;
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
        kreaderSync: S.kreaderSync,
        exportFormat: S.exportFormat,
        exportScope: S.exportScope,
        exportBitrate: S.exportBitrate,
        chatReadScope: S.chatReadScope,
        chatReadIndex: S.chatReadIndex,
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
  function setKreaderSync(enabled) {
    S.kreaderSync = !!enabled;
    savePrefs();
    window.dispatchEvent(new CustomEvent('vox-kreader-sync', { detail: { enabled: S.kreaderSync } }));
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
      try { f.contentWindow?.postMessage({ ...payload, nonce: iframeBridgeNonce }, '*'); } catch (_) {}
    });
  }

  function initializeIframeBridges() {
    broadcastToIframes({ source: IFRAME_INIT_MSG });
  }

  initializeIframeBridges();
  setTimeout(initializeIframeBridges, 500);
  setTimeout(initializeIframeBridges, 1500);

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
      const requestId = crypto.randomUUID();
      const normalized = (text || '').replace(/\s+/g, ' ').trim();
      const selectedSource = frameSelection.text === text &&
        Date.now() - frameSelection.at < FRAME_SEL_TTL_MS
        ? frameSelection.source
        : null;
      function onMsg(ev) {
        if (ev.data?.source !== IFRAME_READ_OK) return;
        if (ev.data.nonce !== iframeBridgeNonce || ev.data.requestId !== requestId) return;
        if (!isKnownIframeWindow(ev.source)) return;
        if (selectedSource && ev.source !== selectedSource) return;
        if (ev.data.words?.length) {
          const responseText = ev.data.words.join(' ').replace(/\s+/g, ' ').trim();
          if (responseText === normalized) best = ev.data.words;
        }
      }
      window.addEventListener('message', onMsg);
      const payload = {
        source: IFRAME_READ_MSG,
        nonce: iframeBridgeNonce,
        requestId,
        // Only send selected text to the frame that reported owning it. When
        // ownership is unknown, each frame checks its own local selection.
        text: selectedSource ? text : '',
        ...iframeThemePayload(),
      };
      initializeIframeBridges();
      setTimeout(() => {
        if (selectedSource) {
          try { selectedSource.postMessage(payload, '*'); } catch (_) {}
        } else {
          broadcastToIframes(payload);
        }
      }, 0);
      setTimeout(() => {
        window.removeEventListener('message', onMsg);
        resolve(best);
      }, 1200);
    });
  }

  async function tryIframeSelectionRead(text, intent) {
    const words = await requestIframeWords(text);
    if (intent != null && !isPlaybackIntentCurrent(intent)) return false;
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
  function applyColors() {
    document.documentElement.style.setProperty('--vox-word-color', S.wordColor);
    const h = S.sentenceHex;
    const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
    S._sentenceRgba = `rgba(${r},${g},${b},0.25)`;
    document.documentElement.style.setProperty('--vox-sentence-color', S.sentenceHex);
    document.documentElement.style.setProperty('--vox-sentence-bg', S._sentenceRgba);
    document.documentElement.classList.toggle('vox-sentence-style-bg', S.sentenceStyle === 'bg');
    document.documentElement.classList.toggle('vox-sentence-style-underline', S.sentenceStyle === 'underline');
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
  async function loadVirtualizedChatHistory(shouldContinue = () => true) {
    const container = getChatScrollContainer();
    if (!container || container.scrollHeight <= container.clientHeight + 50) return;

    const savedScroll = container.scrollTop;
    let lastCount = getChatRoots().length;
    let stablePasses = 0;

    container.scrollTop = 0;
    await sleep(150);

    for (let step = 0; step < 50 && stablePasses < 3; step++) {
      if (!shouldContinue()) break;
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
    if (opts.intent != null && !isPlaybackIntentCurrent(opts.intent)) return;
    const chatRoots = getChatRoots();
    const needsFullHistory = opts.forceFullHistory || (
      chatRoots.length && !chatRoots.some(r => r.querySelector('.vox-word'))
    );
    if (needsFullHistory && await confirmFullThreadLoad()) {
      setStatus('Loading conversation…', true);
      await loadVirtualizedChatHistory(
        () => opts.intent == null || isPlaybackIntentCurrent(opts.intent),
      );
    }
    if (opts.intent != null && !isPlaybackIntentCurrent(opts.intent)) return;
    await new Promise((resolve) => {
      rewrap((cancelled) => {
        try {
          if (!cancelled && (opts.intent == null || isPlaybackIntentCurrent(opts.intent))) {
            if (cb) cb();
          }
        } finally { resolve(); }
      }, () => opts.intent == null || isPlaybackIntentCurrent(opts.intent));
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
      if (S.voiceEngine === 'kokoro') {
        if (S.lastKokoroChunk) {
          const si = getSentenceIdx(newIdx);
          S.lastKokoroChunk.sent = si >= 0 ? S.sentences[si] : null;
          S.lastKokoroChunk.highlightStart = newIdx;
        }
        restartKokoroTicker();
      }
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
    return VoxCore.filterChatRoots(roots, S.chatReadScope, S.chatReadIndex);
  }

  function getReadableRoots() {
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

  function waitForContent(cb, maxWait = 8000, shouldContinue = () => true) {
    const start = Date.now();
    let lastLen = 0, stableMs = 0;
    function check() {
      if (!shouldContinue()) {
        cb([], true);
        return;
      }
      const roots = getReadableRoots();
      const len  = rootsTextLength(roots);
      const elapsed = Date.now() - start;
      if (len > 200) {
        if (len === lastLen) {
          stableMs += 300;
          if (stableMs >= 600) { cb(roots, false); return; }
        } else {
          stableMs = 0;
        }
      }
      lastLen = len;
      if (elapsed > maxWait) { cb(roots, false); return; }
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
        const frag = document.createDocumentFragment();
        const re = /(\S+|\s+)/g; let m;
        while ((m = re.exec(text)) !== null) {
          if (/\S/.test(m[0])) {
            const span = document.createElement('span');
            span.className = 'vox-word';
            span.textContent = m[0];
            span.dataset.voxIndex = S.words.length;
            S.words.push({ el: span, text: m[0] });
            frag.appendChild(span);
          } else {
            frag.appendChild(document.createTextNode(m[0]));
          }
        }
        node.parentNode.replaceChild(frag, node);
      } else if (node.nodeType === Node.ELEMENT_NODE && !shouldSkipWalk(node)) {
        Array.from(node.childNodes).forEach(walk);
        if (node.shadowRoot) Array.from(node.shadowRoot.childNodes).forEach(walk);
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
        const midFrag = document.createDocumentFragment();
        const re = /(\S+|\s+)/g;
        let m;
        while ((m = re.exec(middle)) !== null) {
          if (/\S/.test(m[0])) {
            const span = document.createElement('span');
            span.className = 'vox-word';
            span.textContent = m[0];
            span.dataset.voxIndex = S.words.length;
            S.words.push({ el: span, text: m[0] });
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

  function buildSentences() {
    S.sentences = VoxCore.buildSentences(S.words.map((word) => word.text));
  }

  function getSentenceIdx(wordIdx) {
    for (let i = 0; i < S.sentences.length; i++) {
      const s = S.sentences[i];
      if (wordIdx >= s.start && wordIdx <= s.end) return i;
    }
    return -1;
  }

  function getSentenceWords(si) {
    if (si < 0 || si >= S.sentences.length) return [];
    const { start, end } = S.sentences[si];
    return S.words.slice(start, end + 1);
  }

  function rewrap(cb, shouldContinue = () => true) {
    // Don't rewrap the regular page while immersive mode is active —
    // immersive mode wraps its own overlay content and rewrapping would
    // strip those spans and then wrap the wrong root.
    if (!shouldContinue()) { if (cb) cb(true); return; }
    if (S.immersiveActive) { if (cb) cb(false); return; }
    S.chatDomDirty = false;
    unwrap();
    const roots = getReadableRoots();
    wrapWords(roots);
    if (S.words.length > 0) { if (cb) cb(false); return; }
    if (!roots.includes(document.body)) {
      wrapWords(document.body);
      if (S.words.length > 0) { if (cb) cb(false); return; }
    }
    waitForContent((r, cancelled) => {
      if (cancelled) { if (cb) cb(true); return; }
      if (!S.words.length) wrapWords(r);
      if (!S.words.length && !normalizeRoots(r).includes(document.body)) wrapWords(document.body);
      if (cb) cb(false);
    }, 8000, shouldContinue);
  }

  function unwrap() {
    S._voxDomUpdate = true;
    clearIframeHighlights();
    document.querySelectorAll('.vox-word').forEach(sp =>
      sp.parentNode.replaceChild(document.createTextNode(sp.textContent), sp));
    S.words = []; S.sentences = []; clearHL();
    S._voxDomUpdate = false;
  }

  // ── Highlighting ──────────────────────────────────────────────────────────
  function placeSentenceOverlays(si) {
    document.querySelectorAll('.vox-sentence-active').forEach(e => e.classList.remove('vox-sentence-active'));
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
    document.querySelectorAll('.vox-sentence-active').forEach(e => e.classList.remove('vox-sentence-active'));
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
    if (S.highlightWord && S.words[idx]) {
      _activeWordEl = S.words[idx].el;
      _activeWordEl.classList.add('vox-word-active');
    }
    const si = getSentenceIdx(idx);
    if (si !== S.currentSentence) {
      const firstWord = S.words[S.sentences[si]?.start];
      if (firstWord) {
        scrollWordIntoView(firstWord.el);
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
  }

  function populateVoices() {
    const sel = document.getElementById('vox-voice-select');
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
  const BASE_CPS = 13;        // estimated chars/sec at rate 1.0
  // Classic speech engine has ~250ms startup delay; Kokoro plays immediately (AudioContext)
  function STARTUP_MS() { return S.voiceEngine === 'kokoro' ? 20 : 250; }

  function buildTimings(startIdx, endIdx) {
    const end = endIdx ?? S.words.length;
    let offset = 0;
    return S.words.slice(startIdx, end).map((w, i) => {
      const ms = STARTUP_MS() + (offset / (BASE_CPS * S.speed)) * 1000;
      offset += w.text.length + 1;
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
    const text = S.words.slice(idx, endIdx + 1).map(w => w.text).join(' ');
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
        if (cc >= ev.charIndex) { wi = i; break; }
        cc += S.words[i].text.length + 1; wi = i + 1;
      }
      const w = Math.min(wi, endIdx);
      if (w > S.currentWord) { S.currentWord = w; highlightAt(w); }
    };

    u.onend = () => {
      stopTicker(); clearHL();
      S.speaking = false; S.paused = false; S.speakEndIdx = null;
      document.documentElement.classList.remove('vox-reading');
      updatePlayBtn(); setStatus('Done'); S.currentWord = 0;
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
    return VoxCore.getSentencesFrom(
      S.words.map((word) => word.text),
      S.sentences,
      startIdx,
      endIdx,
    );
  }

  function buildKokoroWordTimings(sent, highlightStart, durationSec) {
    if (!sent || !durationSec) {
      return buildTimings(highlightStart, sent ? sent.end + 1 : undefined);
    }
    const fromLocal = Math.max(0, highlightStart - sent.start);
    const words = S.words.slice(sent.start + fromLocal, sent.end + 1);
    if (!words.length) return [];
    const totalChars = words.reduce((s, w) => s + w.text.length + 1, 0) || 1;
    let charOffset = 0;
    return words.map((w, i) => {
      const ms = (charOffset / totalChars) * durationSec * 1000;
      charOffset += w.text.length + 1;
      return { wordIdx: highlightStart + i, ms };
    });
  }

  function applyKokoroChunk(msg) {
    const si = getSentenceIdx(msg.startWordIdx);
    const sent = si >= 0 ? S.sentences[si] : null;
    const highlightStart = Math.max(S.currentWord, msg.startWordIdx);
    const timings = buildKokoroWordTimings(sent, highlightStart, msg.duration);
    S.currentWord = highlightStart;
    highlightAt(highlightStart);
    startTicker(timings, msg.startedAt);
    S.lastKokoroChunk = {
      sent,
      highlightStart,
      duration: msg.duration,
      startedAt: msg.startedAt,
    };
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
      S.pendingPlayIntent = playbackIntentGen;
      setStatus('Downloading AI voice… reading will start when ready', true);
      startKokoroDownload();
      return;
    }
    stopTicker(); clearHL();
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

    const playbackId = ++S.kokoroPlaybackId;
    sendMsg({
      action: 'kokoro_speak',
      sentences,
      speed: S.speed,
      voice: S.kokoroVoice,
      playbackId,
    });
  }

  // ── Engine dispatcher ──────────────────────────────────────────────────────
  function speakFrom(idx, endIdx) {
    if (endIdx != null) S.speakEndIdx = endIdx;
    if (S.voiceEngine === 'kokoro') kokoroSpeakFrom(idx);
    else classicSpeakFrom(idx);
  }

  function pauseResume() {
    if (S.paused) {
      S.paused = false;
      if (S.voiceEngine === 'kokoro') {
        sendMsg({ action: 'kokoro_resume', playbackId: S.kokoroPlaybackId });
        setStatus('Playing', true);
      } else {
        speakFrom(S.currentWord, S.speakEndIdx);
      }
      updatePlayBtn();
      return;
    }
    if (!S.speaking) return;
    stopTicker();
    if (S.voiceEngine === 'kokoro') {
      sendMsg({ action: 'kokoro_pause', playbackId: S.kokoroPlaybackId });
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
    invalidatePlaybackIntent();
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
      sendMsg({ action: 'kokoro_stop', playbackId: S.kokoroPlaybackId });
    } else {
      window.speechSynthesis.cancel();
    }
    stopTicker(); clearHL();
    clearIframeHighlights();
    S.lastKokoroChunk = null;
    S.speaking = false; S.paused = false; S.speakEndIdx = null;
    if (reset) S.currentWord = 0;
    document.documentElement.classList.remove('vox-reading');
    updatePlayBtn();
    setStatus((cancellingExportWait || droppedQueuedExport) ? 'Export cancelled' : 'Stopped');
    savePrefs();
  }

  function skipBack() {
    if (!S.words.length) return;
    const maxIdx = S.speakEndIdx != null ? S.speakEndIdx : S.words.length - 1;
    const t = Math.max(0, S.currentWord - 15);
    S.currentSentence = -1;
    if (S.speaking || S.paused) speakFrom(t, S.speakEndIdx);
    else { S.currentWord = t; highlightAt(t); }
  }
  function skipFwd() {
    if (!S.words.length) return;
    const maxIdx = S.speakEndIdx != null ? S.speakEndIdx : S.words.length - 1;
    const t = Math.min(maxIdx, S.currentWord + 15);
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

    if (!document.getElementById('vox-player')) createPlayer();

    stop(false);
    const intent = beginPlaybackIntent();
    unwrap();

    const range = getSelectionRange();
    if (range && wrapWordsInRange(range)) {
      const endIdx = S.words.length - 1;
      setStatus('Reading selection…', true);
      speakFrom(0, endIdx);
      return;
    }

    if (await tryIframeSelectionRead(text, intent)) return;
    if (!isPlaybackIntentCurrent(intent)) return;

    await prepareAndRewrap(() => {
      if (!isPlaybackIntentCurrent(intent)) return;
      const idx = findWordIdxForText(text);
      if (idx < 0) {
        setStatus('Selection not found on page');
        return;
      }
      const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
      const endIdx = Math.min(idx + wordCount - 1, S.words.length - 1);
      setStatus('Reading selection…', true);
      speakFrom(idx, endIdx);
    }, { intent });
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
    document.getElementById('vox-immersive-exit').onclick = exitImmersive;

    document.getElementById('vox-imm-prev').onclick = () => {
      const si = Math.max(0, S.currentSentence - 1);
      if (S.sentences[si]) speakFrom(S.sentences[si].start, S.speakEndIdx);
    };
    document.getElementById('vox-imm-next').onclick = () => {
      const si = Math.min(S.sentences.length - 1, S.currentSentence + 1);
      if (S.sentences[si]) speakFrom(S.sentences[si].start, S.speakEndIdx);
    };

    const btn = document.getElementById('vox-immersive-btn');
    if (btn) btn.classList.add('active');
    stop(false); unwrap();
    wrapWords(document.getElementById('vox-immersive-content'));
    S.currentWord = 0;
    S.currentSentence = -1;
    S.speakEndIdx = null;
    syncPrintUI();
  }

  function exitImmersive() {
    stop(true); unwrap();
    if (S.immersiveOverlay) { S.immersiveOverlay.remove(); S.immersiveOverlay = null; }
    S.immersiveActive = false;
    const btn = document.getElementById('vox-immersive-btn');
    if (btn) btn.classList.remove('active');
    syncPrintUI();
    setStatus('Ready');
  }

  function printReadable() {
    if (!S.immersiveActive) {
      window.print();
      return;
    }
    const content = document.getElementById('vox-immersive-content');
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
    const panel = document.getElementById('vox-chat-read-section');
    if (!panel) return;
    const roots = getChatRoots();
    panel.classList.toggle('vs-hidden', roots.length < 2);
    if (roots.length < 2) return;

    const scopeEl = document.getElementById('chat-read-scope');
    const idxEl = document.getElementById('chat-read-index');
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
      const wasActive = S.speaking || S.paused;
      const anchor = getWordAnchor(S.currentWord);
      if (wasActive) stop(false);
      const intent = wasActive ? beginPlaybackIntent() : null;
      prepareAndRewrap(() => {
        let idx = anchor ? findWordIdxForText(anchor, 0) : -1;
        if (idx < 0) idx = 0;
        S.currentWord = idx;
        S.speakEndIdx = null;
        if (wasActive && isPlaybackIntentCurrent(intent)) speakFrom(idx);
        else if (S.words[idx]) highlightAt(idx);
      }, { intent });
    }
  }

  function syncPrintUI() {
    const btn = document.getElementById('exp-pdf');
    if (!btn) return;
    btn.title = S.immersiveActive ? 'Print reader view' : 'Print this page';
  }

  // ── Audio export ───────────────────────────────────────────────────────────
  const MAX_EXPORT_WORDS = 2500;

  function getExportWordRange() {
    let selectionStart = null;
    let selectionWordCount = 0;
    if (S.exportScope === 'selection') {
      const text = getSelectionText();
      if (!text) return null;
      selectionStart = findWordIdxForText(text);
      selectionWordCount = text.trim().split(/\s+/).filter(Boolean).length;
    }
    return VoxCore.resolveExportRange({
      scope: S.exportScope,
      wordCount: S.words.length,
      currentWord: S.currentWord,
      speakEndIdx: S.speakEndIdx,
      selectionStart,
      selectionWordCount,
    });
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
    const btn = document.getElementById('exp-mp3');
    const fmt = document.getElementById('export-format');
    const scope = document.getElementById('export-scope');
    const bitrate = document.getElementById('export-bitrate');
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
    sendMsg({ action: 'kokoro_load', voice: S.kokoroVoice });
  }

  function syncInstallUI() {
    const panel = document.getElementById('vox-kokoro-install');
    const playBtn = document.getElementById('vox-playpause-bar');
    const cancelBtn = document.getElementById('vox-install-cancel');
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
    const bar = document.getElementById('vox-install-progress');
    const fileEl = document.getElementById('vox-install-file');
    const statusEl = document.getElementById('vox-install-status');
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
    const sel = document.getElementById('vox-kokoro-voice-select');
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
    const voiceSel = document.getElementById('vox-kokoro-voice-select');
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
    const classicSection = document.getElementById('vox-classic-voice-section');
    const kokoroSection  = document.getElementById('vox-kokoro-section');
    const engClassic = document.getElementById('eng-classic');
    const engKokoro  = document.getElementById('eng-kokoro');
    if (classicSection) classicSection.classList.toggle('vs-hidden', S.voiceEngine === 'kokoro');
    if (kokoroSection)  kokoroSection.classList.toggle('vs-hidden', S.voiceEngine === 'classic');
    if (engClassic) engClassic.classList.toggle('active', S.voiceEngine === 'classic');
    if (engKokoro)  engKokoro.classList.toggle('active', S.voiceEngine === 'kokoro');

    if (S.voiceEngine === 'kokoro') {
      // S.kokoroLoading reflects in-progress load this session; takes priority over cached flag
      setKokoroUIState(S.kokoroLoading || !S.kokoroModelCached ? 'loading' : 'ready');
    }
    syncExportUI();
  }

  // ── Player ─────────────────────────────────────────────────────────────────
  function createPlayer() {
    if (document.getElementById('vox-player')) {
      document.getElementById('vox-player').classList.remove('vox-hidden');
      populateVoices(); populateKokoroVoices(); syncEngineUI(); syncInstallUI(); syncExportUI(); syncPrintUI(); return;
    }

    const p = document.createElement('div');
    p.id = 'vox-player';
    p.setAttribute('role', 'region');
    p.setAttribute('aria-label', 'Vox Reader player');

    p.innerHTML = `
      <!-- Compact bar -->
      <div id="vox-bar">
        <button class="vox-bar-btn" id="vox-back-bar" title="Back 15 words" aria-label="Skip back 15 words">
          <span class="vox-skip-label" aria-hidden="true"><span class="vox-skip-icon">↺</span><span>-15</span></span>
        </button>
        <button id="vox-playpause-bar" aria-label="Play">▶</button>
        <button class="vox-bar-btn" id="vox-fwd-bar" title="Forward 15 words" aria-label="Skip forward 15 words">
          <span class="vox-skip-label" aria-hidden="true"><span class="vox-skip-icon">↻</span><span>+15</span></span>
        </button>
        <div class="vox-div" aria-hidden="true"></div>
        <div id="vox-progress-wrap">
          <input type="range" id="vox-progress" min="0" max="1000" value="0"
            aria-label="Reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        </div>
        <div class="vox-div" aria-hidden="true"></div>
        <button class="vox-bar-btn" id="vox-immersive-btn" title="Immersive reader" aria-label="Toggle immersive reader">☰</button>
        <button id="vox-speed-pill" aria-label="Playback speed">1.0×</button>
        <button class="vox-bar-btn" id="vox-settings-btn" title="Settings" aria-label="Open settings">⚙</button>
        <button class="vox-bar-btn" id="vox-close-bar" title="Close" aria-label="Close player">✕</button>
      </div>

      <div id="vox-kokoro-install" class="vs-hidden" role="alert" aria-live="polite">
        <p id="vox-install-status">AI Neural voice required — downloading once (~86MB)</p>
        <progress id="vox-install-progress" max="100" value="0" aria-label="Download progress"></progress>
        <p id="vox-install-file" class="vs-label-muted"></p>
        <button type="button" class="vs-install-cancel vs-hidden" id="vox-install-cancel">Cancel download</button>
      </div>

      <!-- Settings panel -->
      <div id="vox-settings" role="dialog" aria-label="Voice settings">
        <div id="vox-settings-header">
          <span class="vox-settings-title">Settings</span>
          <button id="vox-settings-close" aria-label="Close settings">✕</button>
        </div>
        <div id="vox-settings-body">

          <!-- Speed + Voice in one compact row area -->
          <div class="vs">
            <div class="vs-speed-row">
              <span class="vs-speed-dim">0.5×</span>
              <input type="range" id="vox-speed-slider" min="0.5" max="3.0" step="0.05" value="1.0" aria-label="Speed">
              <span class="vs-speed-val" id="vox-speed-val">1.0×</span>
            </div>
          </div>

          <!-- Voice Engine + voice select — single compact section -->
          <div class="vs">
            <div class="vs-engine-row" role="group" aria-label="Voice engine">
              <button class="vs-engine-btn ${S.voiceEngine==='classic'?'active':''}" id="eng-classic" aria-pressed="${S.voiceEngine==='classic'}">Classic</button>
              <button class="vs-engine-btn ${S.voiceEngine==='kokoro'?'active':''}" id="eng-kokoro" aria-pressed="${S.voiceEngine==='kokoro'}">AI Neural</button>
            </div>
            <!-- Classic voice -->
            <div class="${S.voiceEngine==='kokoro'?'vs-hidden':''}" id="vox-classic-voice-section" style="margin-top:6px">
              <select id="vox-voice-select" aria-label="Select voice"></select>
            </div>
            <!-- Kokoro voice — model downloads on first enable -->
            <div class="${S.voiceEngine==='classic'?'vs-hidden':''}" id="vox-kokoro-section" style="margin-top:6px">
              <select id="vox-kokoro-voice-select" aria-label="Kokoro voice"></select>
              <p class="vs-kokoro-info">Default voice: Bella · one-time ~86MB download</p>
            </div>
          </div>

          <!-- Highlight toggles + style — compact two-row layout -->
          <div class="vs">
            <div class="vs-hl-row">
              <div class="vs-hl-left">
                <div class="vs-hl-toggle-pair">
                  <span>Word</span>
                  <button class="vs-toggle ${S.highlightWord?'on':''}" id="tog-word" role="switch" aria-checked="${S.highlightWord}" aria-label="Highlight word"></button>
                </div>
                <div class="vs-hl-toggle-pair">
                  <span>Sentence</span>
                  <button class="vs-toggle ${S.highlightSentence?'on':''}" id="tog-sentence" role="switch" aria-checked="${S.highlightSentence}" aria-label="Highlight sentence"></button>
                </div>
              </div>
              <div class="vs-hl-right">
                <button class="vs-hl-btn ${S.sentenceStyle==='bg'?'active':''}" id="hl-bg" aria-pressed="${S.sentenceStyle==='bg'}">BG</button>
                <button class="vs-hl-btn ${S.sentenceStyle==='underline'?'active':''}" id="hl-ul" aria-pressed="${S.sentenceStyle==='underline'}">___</button>
                <input class="vs-hex-mini" id="hex-word" maxlength="7" value="${S.wordColor}" title="Word color" style="border-color:${S.wordColor}">
                <input class="vs-hex-mini" id="hex-sentence" maxlength="7" value="${S.sentenceHex}" title="Sentence color" style="border-color:${S.sentenceHex}">
              </div>
            </div>
          </div>

          <!-- Shortcuts — inline 3-key row -->
          <div class="vs">
            <p class="vs-kokoro-info">Page-only keys · global Chrome shortcuts: chrome://extensions/shortcuts</p>
            <div class="vs-sc-inline">
              <span class="vs-sc-lbl">Alt+</span>
              <label class="vs-sc-pair"><span>▶</span><input class="vs-sc-input" id="sc-play" maxlength="1"></label>
              <label class="vs-sc-pair"><span>■</span><input class="vs-sc-input" id="sc-stop" maxlength="1"></label>
              <label class="vs-sc-pair"><span>sel</span><input class="vs-sc-input" id="sc-read" maxlength="1"></label>
              <label class="vs-sc-pair"><span>exp</span><input class="vs-sc-input" id="sc-export" maxlength="1"></label>
              <button class="vs-sc-save" id="sc-save">Save</button>
            </div>
          </div>

          <!-- Chat reply scope (shown when multiple assistant messages detected) -->
          <div class="vs vs-hidden" id="vox-chat-read-section">
            <label class="vs-label">Chat reading</label>
            <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
              <select id="chat-read-scope" class="vs-export-format" style="max-width:120px" aria-label="Which replies to read">
                <option value="all" ${S.chatReadScope==='all'?'selected':''}>All replies</option>
                <option value="latest" ${S.chatReadScope==='latest'?'selected':''}>Latest only</option>
                <option value="single" ${S.chatReadScope==='single'?'selected':''}>One reply</option>
              </select>
              <select id="chat-read-index" class="vs-export-format vs-hidden" style="max-width:120px" aria-label="Reply number"></select>
            </div>
          </div>

          <!-- KReader sync (optional, off by default) -->
          <div class="vs">
            <div class="vs-hl-toggle-pair">
              <span>KReader sync</span>
              <button class="vs-toggle ${S.kreaderSync?'on':''}" id="tog-kreader" role="switch" aria-checked="${S.kreaderSync}" aria-label="KReader highlight sync"></button>
            </div>
            <p class="vs-kokoro-info">Sync highlights with local KReader app on 127.0.0.1:8766</p>
          </div>

          <!-- Export + status on same row -->
          <div class="vs vs-bottom-row">
            <button class="vs-export-btn" id="exp-pdf" title="Print this page">Print</button>
            <select id="export-scope" class="vs-export-format" aria-label="Export scope" title="What to export">
              <option value="all" ${S.exportScope==='all'?'selected':''}>All</option>
              <option value="selection" ${S.exportScope==='selection'?'selected':''}>Selection</option>
              <option value="here" ${S.exportScope==='here'?'selected':''}>From here</option>
            </select>
            <select id="export-format" class="vs-export-format" aria-label="Export format" title="Export format">
              <option value="mp3" ${S.exportFormat==='mp3'?'selected':''}>MP3</option>
              <option value="wav" ${S.exportFormat==='wav'?'selected':''}>WAV</option>
            </select>
            <select id="export-bitrate" class="vs-export-format ${S.exportFormat==='wav'?'vs-hidden':''}" aria-label="MP3 bitrate" title="MP3 bitrate">
              <option value="96" ${S.exportBitrate===96?'selected':''}>96k</option>
              <option value="128" ${S.exportBitrate===128?'selected':''}>128k</option>
              <option value="192" ${S.exportBitrate===192?'selected':''}>192k</option>
            </select>
            <button class="vs-export-btn" id="exp-mp3" title="Download audio (Kokoro) or preview (classic)">Export</button>
            <span id="vox-status" role="status" aria-live="polite">Ready</span>
          </div>

        </div>
      </div>`;

    document.documentElement.appendChild(p);
    S.playerEl = p;
    chrome.storage.sync.get(['barX','barY'], (pos) => {
      if (pos.barX != null) {
        p.style.left = pos.barX + 'px';
        p.style.top = pos.barY + 'px';
        p.style.bottom = 'auto';
        p.style.transform = 'none';
      }
    });
    bindEvents();
    loadVoices();
    populateKokoroVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    document.getElementById('vox-speed-slider').value = S.speed;
    const sl = S.speed.toFixed(1) + '×';
    document.getElementById('vox-speed-val').textContent = sl;
    document.getElementById('vox-speed-pill').textContent = sl;
    document.getElementById('sc-play').value = S.shortcuts.play;
    document.getElementById('sc-stop').value = S.shortcuts.stop;
    document.getElementById('sc-read').value = S.shortcuts.read;
    document.getElementById('sc-export').value = S.shortcuts.export;
    // If engine was already set to kokoro from saved prefs, mark loading before syncEngineUI
    // so the UI renders in loading state, then kick off the model load.
    // Offscreen handles already-loaded case with `if (synthesizer) return`.
    startChatObserver();
    initializeIframeBridges();
    syncEngineUI();
    syncPrintUI();
    syncChatReadUI();
    window.dispatchEvent(new CustomEvent('vox-kreader-sync', { detail: { enabled: S.kreaderSync } }));
    if (S.voiceEngine === 'kokoro' && !S.kokoroModelCached) {
      startKokoroDownload();
    } else {
      syncInstallUI();
    }
  }

  function bindEvents() {
    document.getElementById('vox-close-bar').onclick = () => { stop(false); S.playerEl.classList.add('vox-hidden'); };

    let _capturedSel = null;
    document.getElementById('vox-playpause-bar').addEventListener('mousedown', () => {
      const text = getSelectionText();
      _capturedSel = text ? { text } : null;
    });

    document.getElementById('vox-playpause-bar').onclick = async () => {
      if (!S.speaking && !S.paused) {
        if (S.exporting) {
          const intent = beginPlaybackIntent();
          S.playAfterExport = true;
          S.playAfterExportIntent = intent;
          setStatus('Will play when export finishes…', true);
          return;
        }
        const intent = beginPlaybackIntent();
        const captured = _capturedSel; _capturedSel = null;
        if (captured) {
          readSelection(captured.text).catch(() => {});
        } else if (!S.words.length || rootsNeedRewrap()) {
          await prepareAndRewrap(() => {
            if (isPlaybackIntentCurrent(intent)) speakFrom(findFirstVisibleWordIdx());
          }, { intent });
        } else {
          if (!isPlaybackIntentCurrent(intent)) return;
          const startIdx = S.currentWord === 0 ? findFirstVisibleWordIdx() : S.currentWord;
          speakFrom(startIdx);
        }
      } else { pauseResume(); }
    };

    document.getElementById('vox-back-bar').onclick = skipBack;
    document.getElementById('vox-fwd-bar').onclick = skipFwd;
    document.getElementById('vox-immersive-btn').onclick = toggleImmersive;

    const speeds = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
    document.getElementById('vox-speed-pill').onclick = () => {
      const ci = speeds.findIndex(s => Math.abs(s - S.speed) < 0.01);
      S.speed = speeds[(ci + 1) % speeds.length];
      const label = S.speed + '×';
      document.getElementById('vox-speed-slider').value = S.speed;
      document.getElementById('vox-speed-val').textContent = label;
      document.getElementById('vox-speed-pill').textContent = label;
      savePrefs();
      if (S.speaking || S.paused) { const i = S.currentWord; speakFrom(i); }
    };

    document.getElementById('vox-settings-btn').onclick = () => {
      S.settingsOpen = !S.settingsOpen;
      document.getElementById('vox-settings').classList.toggle('open', S.settingsOpen);
      if (S.settingsOpen) syncChatReadUI();
    };
    document.getElementById('vox-settings-close').onclick = () => {
      S.settingsOpen = false;
      document.getElementById('vox-settings').classList.remove('open');
    };

    const speedSlider = document.getElementById('vox-speed-slider');
    speedSlider.oninput = (e) => {
      S.speed = parseFloat(e.target.value);
      const label = S.speed.toFixed(2).replace(/\.?0+$/,'') + '×';
      document.getElementById('vox-speed-val').textContent = label;
      document.getElementById('vox-speed-pill').textContent = label;
    };
    speedSlider.onchange = (e) => {
      S.speed = parseFloat(e.target.value);
      savePrefs();
      if (S.speaking || S.paused) { const i = S.currentWord; speakFrom(i); }
    };

    // Classic voice select
    document.getElementById('vox-voice-select').onchange = (e) => {
      const v = window.speechSynthesis.getVoices().find(v => v.name === e.target.value);
      if (v) {
        S.voice = v; S.selectedVoiceName = v.name; savePrefs();
        if (S.speaking) { const i = S.currentWord; stop(false); speakFrom(i); }
      }
    };

    // Voice engine toggle
    document.getElementById('eng-classic').onclick = () => {
      if (S.voiceEngine === 'classic') return;
      stop(false);
      S.pendingPlayAfterKokoro = false;
      S.voiceEngine = 'classic'; savePrefs(); syncEngineUI();
      document.getElementById('eng-classic').setAttribute('aria-pressed', 'true');
      document.getElementById('eng-kokoro').setAttribute('aria-pressed', 'false');
    };
    document.getElementById('eng-kokoro').onclick = () => {
      if (S.voiceEngine === 'kokoro') return;
      stop(false);
      S.voiceEngine = 'kokoro';
      savePrefs();
      syncEngineUI();
      document.getElementById('eng-classic').setAttribute('aria-pressed', 'false');
      document.getElementById('eng-kokoro').setAttribute('aria-pressed', 'true');
      if (!S.kokoroModelCached) startKokoroDownload();
      else { setKokoroUIState('ready'); setStatus('AI voice ready — press Play', true); }
    };

    document.getElementById('vox-kokoro-voice-select').onchange = (e) => {
      S.kokoroVoice = e.target.value;
      savePrefs();
      if (S.kokoroModelCached) {
        sendMsg({ action: 'kokoro_warm_voice', voice: S.kokoroVoice });
        if (S.speaking || S.paused) speakFrom(S.currentWord);
      }
    };

    // Progress bar
    const prog = document.getElementById('vox-progress');
    prog.oninput = () => { S.scrubbing = true; };
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

    // Highlight toggles
    document.getElementById('tog-word').onclick = (e) => {
      S.highlightWord = !S.highlightWord;
      e.target.classList.toggle('on', S.highlightWord);
      e.target.setAttribute('aria-checked', String(S.highlightWord));
      savePrefs();
    };
    document.getElementById('tog-sentence').onclick = (e) => {
      S.highlightSentence = !S.highlightSentence;
      e.target.classList.toggle('on', S.highlightSentence);
      e.target.setAttribute('aria-checked', String(S.highlightSentence));
      savePrefs();
    };
    document.getElementById('tog-kreader').onclick = (e) => {
      const next = !S.kreaderSync;
      e.target.classList.toggle('on', next);
      e.target.setAttribute('aria-checked', String(next));
      setKreaderSync(next);
      setStatus(next ? 'KReader sync on' : 'KReader sync off');
    };

    document.getElementById('hl-bg').onclick = () => {
      S.sentenceStyle = 'bg';
      document.getElementById('hl-bg').classList.add('active');
      document.getElementById('hl-bg').setAttribute('aria-pressed','true');
      document.getElementById('hl-ul').classList.remove('active');
      document.getElementById('hl-ul').setAttribute('aria-pressed','false');
      applyColors(); savePrefs();
    };
    document.getElementById('hl-ul').onclick = () => {
      S.sentenceStyle = 'underline';
      document.getElementById('hl-ul').classList.add('active');
      document.getElementById('hl-ul').setAttribute('aria-pressed','true');
      document.getElementById('hl-bg').classList.remove('active');
      document.getElementById('hl-bg').setAttribute('aria-pressed','false');
      applyColors(); savePrefs();
    };

    function bindHex(inputId, setter) {
      const el = document.getElementById(inputId);
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

    document.getElementById('sc-save').onclick = () => {
      S.shortcuts.play = document.getElementById('sc-play').value || 'p';
      S.shortcuts.stop = document.getElementById('sc-stop').value || 's';
      S.shortcuts.read = document.getElementById('sc-read').value || 'r';
      S.shortcuts.export = document.getElementById('sc-export').value || 'e';
      savePrefs(); setStatus('Page shortcuts saved — Chrome shortcuts are managed separately');
    };

    document.getElementById('exp-pdf').onclick = () => printReadable();
    document.getElementById('exp-mp3').onclick = exportAudio;
    document.getElementById('vox-install-cancel')?.addEventListener('click', cancelKokoroDownload);
    document.getElementById('export-format').onchange = (e) => {
      S.exportFormat = e.target.value === 'wav' ? 'wav' : 'mp3';
      savePrefs();
      syncExportUI();
    };
    document.getElementById('export-scope').onchange = (e) => {
      const v = e.target.value;
      S.exportScope = (v === 'selection' || v === 'here') ? v : 'all';
      savePrefs();
      syncExportUI();
    };
    document.getElementById('export-bitrate').onchange = (e) => {
      const n = parseInt(e.target.value, 10);
      S.exportBitrate = [96, 128, 192].includes(n) ? n : 128;
      savePrefs();
    };
    document.getElementById('chat-read-scope').onchange = (e) => {
      const v = e.target.value;
      S.chatReadScope = (v === 'latest' || v === 'single') ? v : 'all';
      onChatReadScopeChange();
    };
    document.getElementById('chat-read-index').onchange = (e) => {
      S.chatReadIndex = Math.max(0, parseInt(e.target.value, 10) || 0);
      onChatReadScopeChange();
    };

    // Click-to-jump (only while speaking/paused)
    document.addEventListener('click', (e) => {
      if (!S.speaking && !S.paused) return;
      const sp = e.target.closest('.vox-word');
      if (!sp || sp.dataset.voxIndex == null) return;
      const idx = parseInt(sp.dataset.voxIndex, 10);
      if (S.speakEndIdx != null && idx > S.speakEndIdx) return;
      speakFrom(idx, S.speakEndIdx);
    });

    // Draggable bar
    const bar = document.getElementById('vox-bar');
    bar.addEventListener('mousedown', (e) => {
      if (e.target.closest('button,input,select')) return;
      S.dragging = true;
      const rect = S.playerEl.getBoundingClientRect();
      S.dragOffsetX = e.clientX - rect.left;
      S.dragOffsetY = e.clientY - rect.top;
      S.playerEl.style.left = rect.left + 'px';
      S.playerEl.style.top = rect.top + 'px';
      S.playerEl.style.bottom = 'auto';
      S.playerEl.style.transform = 'none';
      e.preventDefault();
    });
    let _dragSaveTimer = null;
    document.addEventListener('mousemove', (e) => {
      if (!S.dragging) return;
      const x = Math.max(0, Math.min(window.innerWidth - S.playerEl.offsetWidth, e.clientX - S.dragOffsetX));
      const y = Math.max(0, Math.min(window.innerHeight - S.playerEl.offsetHeight, e.clientY - S.dragOffsetY));
      S.playerEl.style.left = x + 'px';
      S.playerEl.style.top = y + 'px';
      clearTimeout(_dragSaveTimer);
      _dragSaveTimer = setTimeout(() => chrome.storage.sync.set({ barX: x, barY: y }), 300);
    });
    document.addEventListener('mouseup', () => { S.dragging = false; });
    window.addEventListener('blur', () => { S.dragging = false; });
  }

  function updatePlayBtn() {
    const btn = document.getElementById('vox-playpause-bar');
    if (!btn) return;
    const playing = S.speaking && !S.paused;
    btn.textContent = playing ? '⏸' : '▶';
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    syncInstallUI();
  }

  function setStatus(text, active = false) {
    const el = document.getElementById('vox-status');
    if (el) { el.textContent = text; el.className = active ? 'playing' : ''; }
  }

  function updateProgress() {
    if (S.scrubbing) return;
    const el = document.getElementById('vox-progress');
    if (!el || S.words.length < 1) return;
    const denom = Math.max(1, S.words.length - 1);
    const val = Math.floor((S.currentWord / denom) * 1000);
    el.value = val;
    el.setAttribute('aria-valuenow', Math.round((S.currentWord / denom) * 100));
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
        if (!S.speaking && !S.paused) document.getElementById('vox-playpause-bar')?.click();
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
      if (!S.speaking) return; // stale chunk from a stopped session
      if (msg.playbackId !== S.kokoroPlaybackId) return;
      applyKokoroChunk(msg);
      setStatus('Playing', true);
      updatePlayBtn();
      return;
    }

    if (msg.action === 'kokoro_end') {
      if (msg.playbackId !== S.kokoroPlaybackId) return;
      stopTicker(); clearHL();
      clearIframeHighlights();
      S.lastKokoroChunk = null;
      S.speaking = false; S.paused = false; S.speakEndIdx = null;
      document.documentElement.classList.remove('vox-reading');
      updatePlayBtn(); setStatus('Done'); S.currentWord = 0;
      maybeRunPendingExport();
      return;
    }

    if (msg.action === 'kokoro_ready') {
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
          S.playAfterExportIntent = S.pendingPlayIntent;
          setStatus('AI voice ready — starting export…', true);
        } else if (S.pendingPlayAfterKokoro) {
          S.pendingPlayAfterKokoro = false;
          const idx = S.pendingPlayStartIdx;
          const intent = S.pendingPlayIntent;
          setStatus('AI voice ready — starting…', true);
          pendingAutoPlayTimer = setTimeout(() => {
            pendingAutoPlayTimer = null;
            if (!isPlaybackIntentCurrent(intent)) return;
            if (S.voiceEngine !== 'kokoro' || !S.kokoroModelCached) return;
            if (!S.words.length || rootsNeedRewrap()) {
              prepareAndRewrap(() => {
                if (isPlaybackIntentCurrent(intent)) {
                  speakFrom(idx >= 0 ? idx : findFirstVisibleWordIdx());
                }
              }, { intent }).catch(() => {});
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
        setStatus(wasPendingExport ? 'Export cancelled' : 'Download cancelled');
      } else if (wasPendingExport) {
        setStatus('Export cancelled');
      }
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
        const intent = S.playAfterExportIntent;
        pendingAutoPlayTimer = setTimeout(() => {
          pendingAutoPlayTimer = null;
          if (isPlaybackIntentCurrent(intent)) {
            document.getElementById('vox-playpause-bar')?.click();
          }
        }, 150);
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
      if (msg.playbackId != null && msg.playbackId !== S.kokoroPlaybackId) return;
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
        if (!S.speaking && !S.paused) document.getElementById('vox-playpause-bar')?.click();
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
