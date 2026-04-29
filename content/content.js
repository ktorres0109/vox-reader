// Vox Reader v3

(function () {
  if (window.__voxReaderLoaded) return;
  window.__voxReaderLoaded = true;

  // Stop reading on any navigation — refresh, back/forward, or SPA route change
  window.addEventListener('beforeunload', () => window.speechSynthesis.cancel());
  window.addEventListener('pagehide',     () => window.speechSynthesis.cancel());

  // SPA navigation — wrap pushState/replaceState to stop reading on route change
  // Wrapped in try/catch: some SPAs (Next.js, Perplexity) freeze history methods
  try {
    ['pushState', 'replaceState'].forEach(method => {
      const orig = history[method];
      history[method] = function (...args) {
        window.speechSynthesis.cancel();
        stopTicker();
        if (S.immersiveActive) exitImmersive();
        return orig.apply(this, args);
      };
    });
  } catch (e) { /* history not writable on this page — skip */ }
  window.addEventListener('popstate', () => {
    window.speechSynthesis.cancel();
    if (S.immersiveActive) exitImmersive();
  });

  // ── State ──────────────────────────────────────────────────────────────────
  const S = {
    words: [], sentences: [],
    speaking: false, paused: false,
    currentWord: 0, currentSentence: -1,
    speed: 1.0, voice: null, voices: [], selectedVoiceName: '',
    playerEl: null, settingsOpen: false,
    immersiveActive: false, immersiveOverlay: null,
    dragging: false, dragOffsetX: 0, dragOffsetY: 0,
    shortcuts: { play: 'p', stop: 's', read: 'r' },
    highlightWord: true, highlightSentence: true,
    sentenceStyle: 'bg',          // 'bg' | 'underline'
    wordColor: '#f59e0b',
    sentenceHex: '#f59e0b',
    scrubbing: false,
    overlayRafPending: false,
  };

  // ── Prefs ──────────────────────────────────────────────────────────────────
  function loadPrefs(cb) {
    chrome.storage.sync.get([
      'speed','voiceName','shortcuts','highlightWord','highlightSentence',
      'sentenceStyle','wordColor','sentenceHex'
    ], (p) => {
      if (p.speed != null) S.speed = p.speed;
      if (p.voiceName) S.selectedVoiceName = p.voiceName;
      if (p.shortcuts) S.shortcuts = { ...S.shortcuts, ...p.shortcuts };
      if (p.highlightWord != null) S.highlightWord = p.highlightWord;
      if (p.highlightSentence != null) S.highlightSentence = p.highlightSentence;
      if (p.sentenceStyle) S.sentenceStyle = p.sentenceStyle;
      if (p.wordColor) S.wordColor = p.wordColor;
      if (p.sentenceHex) S.sentenceHex = p.sentenceHex;
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
      });
    } catch(e) { /* extension reloaded mid-session, ignore */ }
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function applyColors() {
    // Word highlight color — used by .vox-word-active CSS rule
    document.documentElement.style.setProperty('--vox-word-color', S.wordColor);
    // Sentence overlay color — parsed for use in placeSentenceOverlays
    const h = S.sentenceHex;
    const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
    S._sentenceRgba = `rgba(${r},${g},${b},0.25)`;
    document.documentElement.style.setProperty('--vox-sentence-color', S.sentenceHex);
    document.documentElement.classList.toggle('vox-sentence-style-bg', S.sentenceStyle === 'bg');
    document.documentElement.classList.toggle('vox-sentence-style-underline', S.sentenceStyle === 'underline');
  }

  // ── Skip / readable root ───────────────────────────────────────────────────
  const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','INPUT','TEXTAREA',
    'NAV','ASIDE','TABLE','FIGURE','CODE','PRE','SELECT','BUTTON','FORM']);
  const SKIP_ROLES = new Set(['navigation','contentinfo','complementary','search']);
  const MATH_CLASS_HINTS = ['math','katex','mathjax','mjx','equation','formula','latex'];
  const CHAT_RESPONSE_SELECTORS = [
    // Gemini: often no ChatGPT-style author role; specific blocks first
    '.model-response',
    '[data-testid="model-response"]',
    '[data-test-id="model-response"]',
    '.gemini-response',
    '[data-message-author-role="assistant"]',
    '[data-testid*="model"]',
    '[data-testid*="assistant"]',
    '[class*="model-response"]',
    '[class*="message-content"]',
    '[class*="markdown"]',
    '[class*="prose"]',
    // Broad fallbacks last — can match a huge wrapper; we narrow below.
    '[class*="response"]',
    'article',
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
    if (isLikelyMapOrMapOverlay(el)) return true;
    if (isMathElement(el)) return true;
    const role = el.getAttribute('role');
    if (role && SKIP_ROLES.has(role)) return true;
    const id = (el.id||'').toLowerCase();
    const cls = (el.className||'').toString().toLowerCase().split(/\s+/);
    const exact = ['toc','sidebar','toolbar','breadcrumb','site-nav','page-nav'];
    return exact.includes(id) || cls.some(c => exact.includes(c));
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

  function lastInDocumentOrder(els) {
    if (!els.length) return null;
    return els.reduce((a, b) => {
      if (a === b) return a;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? b : a;
    });
  }

  /** Drop ancestors when a descendant is also a candidate (keep the inner / specific node). */
  function innermostOnlyCandidates(nodes) {
    return nodes.filter((n) => !nodes.some((m) => m !== n && n.contains(m)));
  }

  /**
   * When a turn has both a map (canvas) and prose as siblings, the outer
   * container matches both; excluding any node with a canvas made us drop
   * the real answer and fall back to <main> — wrapping the whole page.
   * Pick a descendant subtree with no canvas (the text column only).
   */
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
    // Prefer the largest no-canvas branch (prose), not a tiny map label.
    cands.sort((a, b) => (b.innerText || '').length - (a.innerText || '').length);
    return cands[0] || host;
  }

  function getRoot() {
    // 0. AI chat pages: prefer tightest (smallest) latest assistant block — not a
    // huge wrapper that also embeds maps/cards, which would wrap map label text.
    const chatCandidates = Array.from(
      document.querySelectorAll(CHAT_RESPONSE_SELECTORS.join(','))
    )
      .filter(el => {
        if (shouldSkip(el)) return false;
        const txt = (el.innerText || '').trim();
        if (txt.length < 120) return false;
        if (isMathLikeText(txt)) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 150 && rect.height > 40;
      });
    if (chatCandidates.length) {
      // Prefer the innermost match (e.g. model body, not a shell), then the latest
      // in *document* order (stable when scrolled / when bottom pixels tie-break wrong).
      const specific = innermostOnlyCandidates(chatCandidates);
      const host = lastInDocumentOrder(specific.length ? specific : chatCandidates);
      const picked = narrowChatRootExcludingMap(host);
      return picked;
    }

    // 1. Markdown body containers (GitHub, GitLab, HackMD, etc.)
    const mdBody = document.querySelector(
      '.markdown-body, [class*="markdown-body"], .markdown-content, .md-content, ' +
      '.post-content, .entry-content, .article-content'
    );
    if (mdBody && (mdBody.innerText||'').trim().length > 100) return mdBody;

    // 2. Semantic tags
    const semantic = document.querySelector('article, main, [role="main"]');
    if (semantic) return semantic;

    // 3. Prose containers (Perplexity, Notion, Medium etc. use [class*="prose"])
    const proseEls = Array.from(document.querySelectorAll('[class*="prose"]'))
      .filter(el => (el.innerText||'').trim().length > 200);
    if (proseEls.length) {
      // Pick the smallest element with sufficient text — not the outermost wrapper
      proseEls.sort((a,b) => (a.innerText||'').length - (b.innerText||'').length);
      return proseEls[0];
    }

    // 4. Score divs by DENSITY: content tags per total child elements
    // This avoids picking outer wrappers (which have low density) over real content divs
    const candidates = Array.from(document.querySelectorAll('div, section'))
      .filter(el => (el.innerText||'').trim().length > 300 && !shouldSkip(el));

    let best = null, bestScore = -1;
    for (const el of candidates) {
      const content = el.querySelectorAll('p,li,h1,h2,h3,h4').length;
      const total   = el.querySelectorAll('*').length || 1;
      const density = content / total;
      // Also weight by absolute text length so we don't pick tiny dense boxes
      const score   = density * Math.log((el.innerText||'').length + 1);
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best || document.body;
  }

  // Wait for dynamic content — for streaming SPAs, wait until text stops growing
  function waitForContent(cb, maxWait = 8000) {
    const start = Date.now();
    let lastLen = 0, stableMs = 0;
    function check() {
      const root = getRoot();
      const len  = (root.innerText||'').trim().length;
      const elapsed = Date.now() - start;

      if (len > 200) {
        if (len === lastLen) {
          stableMs += 300;
          // Content stable for 600ms — safe to wrap
          if (stableMs >= 600) { cb(root); return; }
        } else {
          stableMs = 0; // still changing — reset stability timer
        }
      }
      lastLen = len;

      if (elapsed > maxWait) { cb(root); return; } // give up, wrap what we have
      setTimeout(check, 300);
    }
    check();
  }

  // ── Word wrapping ──────────────────────────────────────────────────────────
  function wrapWords(root) {
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
      } else if (node.nodeType === Node.ELEMENT_NODE && !shouldSkip(node)) {
        Array.from(node.childNodes).forEach(walk);
      }
    }
    Array.from(root.childNodes).forEach(walk);
    buildSentences();
    applyColors();
  }

  function buildSentences() {
    S.sentences = [];
    if (!S.words.length) return;
    let start = 0;
    for (let i = 0; i < S.words.length; i++) {
      if (/[.!?]["')\]]*$/.test(S.words[i].text) && S.words[i].text.length > 1) {
        S.sentences.push({ start, end: i });
        start = i + 1;
      }
    }
    if (start < S.words.length) S.sentences.push({ start, end: S.words.length - 1 });
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

  function rewrap(cb) {
    unwrap();

    // Try synchronous wrap first — works immediately on static/fully-loaded pages
    const root = getRoot();
    wrapWords(root);

    if (S.words.length > 0) {
      if (cb) cb();
      return;
    }

    // No words found from root — try body as fallback
    if (root !== document.body) {
      wrapWords(document.body);
      if (S.words.length > 0) { if (cb) cb(); return; }
    }

    // Still nothing — page is still loading (SPA/streaming), poll until stable
    waitForContent((r) => {
      if (!S.words.length) wrapWords(r);
      if (!S.words.length && r !== document.body) wrapWords(document.body);
      if (cb) cb();
    });
  }
  function unwrap() {
    document.querySelectorAll('.vox-word').forEach(sp =>
      sp.parentNode.replaceChild(document.createTextNode(sp.textContent), sp));
    S.words = []; S.sentences = []; clearHL();
  }

  // ── Highlighting ──────────────────────────────────────────────────────────
  // Uses CSS class on the word span (not overlays) so text is always visible.
  // Sentence highlight is applied directly to sentence word spans.

  function placeSentenceOverlays(si) {
    document.querySelectorAll('.vox-sentence-active').forEach(e => e.classList.remove('vox-sentence-active'));
    if (!S.highlightSentence || si < 0) return;
    const words = getSentenceWords(si);
    if (!words.length) return;
    words.forEach(w => w.el.classList.add('vox-sentence-active'));
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
  }

  function highlightAt(idx) {
    if (_activeWordEl) { _activeWordEl.classList.remove('vox-word-active'); _activeWordEl = null; }
    if (S.highlightWord && S.words[idx]) {
      _activeWordEl = S.words[idx].el;
      _activeWordEl.classList.add('vox-word-active');
    }

    // Sentence overlay: redraw and scroll when sentence changes
    const si = getSentenceIdx(idx);
    if (si !== S.currentSentence) {
      // Scroll the first word of the new sentence to center before drawing overlays
      // so getBoundingClientRect() is correct when we place them
      const firstWord = S.words[S.sentences[si]?.start];
      if (firstWord) {
        firstWord.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  // ── Voices ─────────────────────────────────────────────────────────────────
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

  // ── TTS ────────────────────────────────────────────────────────────────────
  const BASE_CPS = 13;        // estimated chars/sec at rate 1.0
  const STARTUP_MS = 250;     // Chrome speech engine startup delay before audio begins

  // { wordIdx, ms } — ms is when that word starts, relative to speech start + startup delay
  function buildTimings(startIdx) {
    let offset = 0;
    return S.words.slice(startIdx).map((w, i) => {
      const ms = STARTUP_MS + (offset / (BASE_CPS * S.speed)) * 1000;
      offset += w.text.length + 1;
      return { wordIdx: startIdx + i, ms };
    });
  }

  function stopTicker() {
    if (S._ticker) { clearInterval(S._ticker); S._ticker = null; }
  }

  function startTicker(timings, startMs) {
    stopTicker();
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
        // onboundary moved ahead — sync ti forward, never go back
        while (ti + 1 < timings.length && timings[ti].wordIdx < S.currentWord) ti++;
      }

      if (ti >= timings.length - 1) stopTicker();
    }, 80);
  }

  function speakFrom(idx) {
    window.speechSynthesis.cancel();
    stopTicker();
    clearHL();
    S.currentWord = idx;
    S.currentSentence = -1;
    if (!S.words.length) return;

    const text = S.words.slice(idx).map(w => w.text).join(' ');
    const u = new SpeechSynthesisUtterance(text);
    u.rate = S.speed; u.lang = 'en-US';
    if (S.voice) u.voice = S.voice;

    // Highlight word 0 of this utterance immediately — ticker condition is
    // wordIdx > S.currentWord so it would skip the first word otherwise
    highlightAt(idx);

    const timings = buildTimings(idx);
    const startMs = Date.now();
    startTicker(timings, startMs);

    // onboundary: only accept forward movement
    u.onboundary = (ev) => {
      if (ev.name !== 'word') return;
      let cc = 0, wi = idx;
      for (let i = idx; i < S.words.length; i++) {
        if (cc >= ev.charIndex) { wi = i; break; }
        cc += S.words[i].text.length + 1; wi = i + 1;
      }
      const w = Math.min(wi, S.words.length - 1);
      if (w > S.currentWord) { S.currentWord = w; highlightAt(w); }
    };

    u.onend = () => {
      stopTicker(); clearHL();
      S.speaking = false; S.paused = false;
      document.documentElement.classList.remove('vox-reading');
      updatePlayBtn(); setStatus('Done'); S.currentWord = 0;
    };
    u.onerror = (e) => {
      stopTicker();
      if (e.error === 'interrupted') return;
      clearHL(); S.speaking = false;
      document.documentElement.classList.remove('vox-reading');
      updatePlayBtn(); setStatus('Error');
    };

    S.speaking = true; S.paused = false;
    document.documentElement.classList.add('vox-reading');
    window.speechSynthesis.speak(u);
    updatePlayBtn(); setStatus('Playing', true);
  }

  // Pause just stops ticker. Resume restarts speech from current word
  // (re-syncing audio + timer cleanly — browser pause/resume drifts)
  function pauseResume() {
    if (!S.speaking) return;
    if (S.paused) {
      speakFrom(S.currentWord); // restart cleanly from where we left off
    } else {
      stopTicker();
      window.speechSynthesis.pause();
      S.paused = true;
      setStatus('Paused');
      updatePlayBtn();
    }
  }

  function stop(reset = false) {
    window.speechSynthesis.cancel(); stopTicker(); clearHL();
    S.speaking = false; S.paused = false;
    if (reset) S.currentWord = 0;
    document.documentElement.classList.remove('vox-reading');
    updatePlayBtn(); setStatus('Stopped'); savePrefs();
  }

  function skipBack() {
    if (!S.words.length) return;
    const t = Math.max(0, S.currentWord - 15);
    S.currentSentence = -1;
    if (S.speaking || S.paused) speakFrom(t);
    else { S.currentWord = t; highlightAt(t); }
  }
  function skipFwd() {
    if (!S.words.length) return;
    const t = Math.min(S.words.length - 1, S.currentWord + 15);
    S.currentSentence = -1;
    if (S.speaking || S.paused) speakFrom(t);
    else { S.currentWord = t; highlightAt(t); }
  }

  // Find the first word visible in the viewport (for play-from-scroll-position)
  function findFirstVisibleWordIdx() {
    if (!S.words.length) return 0;
    for (let i = 0; i < S.words.length; i++) {
      const rect = S.words[i].el.getBoundingClientRect();
      if (rect.top >= 0 && rect.bottom > 0) return i;
    }
    return 0;
  }

  // Selection → start reading from that word onward with full highlighting
  function handleSel(selText, anchor) {
    function findAnchorIdx() {
      if (!anchor || !S.words.length) return -1;
      let el = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
      while (el && !el.classList?.contains('vox-word')) el = el.parentElement;
      return (el && el.dataset.voxIndex != null) ? parseInt(el.dataset.voxIndex) : -1;
    }

    function findByText(text) {
      const first = text.trim().split(/\s+/)[0].replace(/\W/g, '').toLowerCase();
      if (!first) return -1;
      return S.words.findIndex(w => w.text.replace(/\W/g, '').toLowerCase() === first);
    }

    if (S.words.length) {
      let idx = findAnchorIdx();
      if (idx < 0) idx = findByText(selText);
      if (idx >= 0) { speakFrom(idx); return; }
    }

    // Words not wrapped yet — rewrap then find by text (old anchor is detached)
    rewrap(() => {
      const idx = findByText(selText);
      speakFrom(idx >= 0 ? idx : 0);
    });
  }

  // ── Immersive ──────────────────────────────────────────────────────────────
  function toggleImmersive() { S.immersiveActive ? exitImmersive() : enterImmersive(); }

  function enterImmersive() {
    const root = getRoot().cloneNode(true);
    root.querySelectorAll('script,style,noscript,nav,aside,table,pre,code,figure,[role="navigation"],[role="complementary"]')
      .forEach(el => el.remove());
    const blocks = [];
    root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li').forEach(el => {
      const t = el.textContent.trim();
      if (t.length > 10 && !isMathLikeText(t) && !isMathElement(el)) {
        blocks.push({ tag: el.tagName.toLowerCase(), text: t });
      }
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
    // Populate content safely via textContent to prevent XSS
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

    // Sentence nav
    document.getElementById('vox-imm-prev').onclick = () => {
      const si = Math.max(0, S.currentSentence - 1);
      if (S.sentences[si]) speakFrom(S.sentences[si].start);
    };
    document.getElementById('vox-imm-next').onclick = () => {
      const si = Math.min(S.sentences.length - 1, S.currentSentence + 1);
      if (S.sentences[si]) speakFrom(S.sentences[si].start);
    };

    const btn = document.getElementById('vox-immersive-btn');
    if (btn) btn.classList.add('active');
    stop(false); unwrap();
    wrapWords(document.getElementById('vox-immersive-content'));
  }

  function exitImmersive() {
    stop(true); unwrap();
    if (S.immersiveOverlay) { S.immersiveOverlay.remove(); S.immersiveOverlay = null; }
    S.immersiveActive = false;
    const btn = document.getElementById('vox-immersive-btn');
    if (btn) btn.classList.remove('active');
    setStatus('Ready');
  }

  // ── Audio export ───────────────────────────────────────────────────────────
  // Note: Web Speech API routes to system audio, not WebAudio — in-page
  // recording cannot capture it. Guide user to use system audio recording.
  function exportAudio() {
    const doExport = () => {
      setStatus('Use system recorder to capture audio', false);
      // Speak the content so the user can record it externally
      const text = S.words.map(w => w.text).join(' ');
      if (!text) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = S.speed; if (S.voice) u.voice = S.voice;
      u.onend = () => setStatus('Done');
      window.speechSynthesis.speak(u);
    };
    if (!S.words.length) { rewrap(doExport); return; }
    doExport();
  }

  // ── Player ─────────────────────────────────────────────────────────────────
  function createPlayer() {
    if (document.getElementById('vox-player')) {
      document.getElementById('vox-player').classList.remove('vox-hidden');
      populateVoices(); return;
    }

    const p = document.createElement('div');
    p.id = 'vox-player';
    p.innerHTML = `
      <!-- Compact bar -->
      <div id="vox-bar">
        <button class="vox-bar-btn" id="vox-back-bar" title="Back 15 words">
          <span class="vox-skip-label"><span class="vox-skip-icon">↺</span><span>-15</span></span>
        </button>
        <button id="vox-playpause-bar">▶</button>
        <button class="vox-bar-btn" id="vox-fwd-bar" title="Forward 15 words">
          <span class="vox-skip-label"><span class="vox-skip-icon">↻</span><span>+15</span></span>
        </button>
        <div class="vox-div"></div>
        <div id="vox-progress-wrap">
          <input type="range" id="vox-progress" min="0" max="1000" value="0">
        </div>
        <div class="vox-div"></div>
        <button class="vox-bar-btn" id="vox-immersive-btn" title="Immersive reader">☰</button>
        <button id="vox-speed-pill">1.0×</button>
        <button class="vox-bar-btn" id="vox-settings-btn" title="Settings">⚙</button>
        <button class="vox-bar-btn" id="vox-close-bar" title="Close">✕</button>
      </div>

      <!-- Settings panel (replaces bar) -->
      <div id="vox-settings">
        <div id="vox-settings-header">
          <span class="vox-settings-title">Settings</span>
          <button id="vox-settings-close">✕</button>
        </div>
        <div id="vox-settings-body">

          <div class="vs">
            <div class="vs-label">Speed</div>
            <div class="vs-speed-row">
              <span class="vs-speed-dim">0.5×</span>
              <input type="range" id="vox-speed-slider" min="0.5" max="3.0" step="0.05" value="1.0">
              <span class="vs-speed-val" id="vox-speed-val">1.0×</span>
            </div>
          </div>

          <div class="vs">
            <div class="vs-label">Voice</div>
            <select id="vox-voice-select"></select>
          </div>

          <div class="vs">
            <div class="vs-label">Highlight</div>
            <div class="vs-toggle-row">
              <span class="vs-toggle-label">Highlight word</span>
              <button class="vs-toggle ${S.highlightWord?'on':''}" id="tog-word"></button>
            </div>
            <div class="vs-toggle-row">
              <span class="vs-toggle-label">Highlight sentence</span>
              <button class="vs-toggle ${S.highlightSentence?'on':''}" id="tog-sentence"></button>
            </div>
            <div class="vs-hl-style">
              <button class="vs-hl-btn ${S.sentenceStyle==='bg'?'active':''}" id="hl-bg">Background</button>
              <button class="vs-hl-btn ${S.sentenceStyle==='underline'?'active':''}" id="hl-ul">Underline</button>
            </div>
            <div class="vs-color-row">
              <div class="vs-color-item">
                <div class="vs-color-item-label">Word color</div>
                <input class="vs-hex-input" id="hex-word" maxlength="7" value="${S.wordColor}" placeholder="#f59e0b">
                <div class="vs-hex-preview" id="prev-word" style="background:${S.wordColor}"></div>
              </div>
              <div class="vs-color-item">
                <div class="vs-color-item-label">Sentence color</div>
                <input class="vs-hex-input" id="hex-sentence" maxlength="7" value="${S.sentenceHex}" placeholder="#f59e0b">
                <div class="vs-hex-preview" id="prev-sentence" style="background:${S.sentenceHex}"></div>
              </div>
            </div>
          </div>

          <div class="vs">
            <div class="vs-label">Shortcuts (Option/Alt + key)</div>
            <div class="vs-sc-row"><span>Play/Pause</span><input class="vs-sc-input" id="sc-play" maxlength="1"></div>
            <div class="vs-sc-row"><span>Stop</span><input class="vs-sc-input" id="sc-stop" maxlength="1"></div>
            <div class="vs-sc-row"><span>Read selection</span><input class="vs-sc-input" id="sc-read" maxlength="1"></div>
            <button class="vs-save-btn" id="sc-save">Save shortcuts</button>
          </div>

          <div class="vs">
            <div class="vs-label">Export</div>
            <div class="vs-export-row">
              <button class="vs-export-btn" id="exp-pdf">📄 PDF</button>
              <button class="vs-export-btn" id="exp-mp3">🎵 Audio</button>
            </div>
          </div>

          <div id="vox-status">Ready</div>
        </div>
      </div>`;

    // Append to <html> root not <body> — SPAs like Perplexity replace body on navigation
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
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    document.getElementById('vox-speed-slider').value = S.speed;
    const sl = S.speed.toFixed(1) + '×';
    document.getElementById('vox-speed-val').textContent = sl;
    document.getElementById('vox-speed-pill').textContent = sl;
    document.getElementById('sc-play').value = S.shortcuts.play;
    document.getElementById('sc-stop').value = S.shortcuts.stop;
    document.getElementById('sc-read').value = S.shortcuts.read;
  }

  function bindEvents() {
    // Close bar
    document.getElementById('vox-close-bar').onclick = () => { stop(false); S.playerEl.classList.add('vox-hidden'); };

    // Capture selection on mousedown — clicking a button clears it before onclick fires
    let _capturedSel = null;
    document.getElementById('vox-playpause-bar').addEventListener('mousedown', () => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      _capturedSel = text ? { text, anchor: sel.anchorNode } : null;
    });

    // Play/pause
    document.getElementById('vox-playpause-bar').onclick = () => {
      if (!S.speaking && !S.paused) {
        const captured = _capturedSel; _capturedSel = null;
        if (captured) {
          handleSel(captured.text, captured.anchor);
        } else if (!S.words.length) {
          rewrap(() => speakFrom(findFirstVisibleWordIdx()));
        } else {
          // Resume from first visible word if at start, otherwise current position
          const startIdx = S.currentWord === 0 ? findFirstVisibleWordIdx() : S.currentWord;
          speakFrom(startIdx);
        }
      } else { pauseResume(); }
    };

    document.getElementById('vox-back-bar').onclick = skipBack;
    document.getElementById('vox-fwd-bar').onclick = skipFwd;
    document.getElementById('vox-immersive-btn').onclick = toggleImmersive;

    // Speed pill: click cycles speeds
    const speeds = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
    document.getElementById('vox-speed-pill').onclick = () => {
      const ci = speeds.findIndex(s => Math.abs(s - S.speed) < 0.01);
      S.speed = speeds[(ci + 1) % speeds.length];
      const label = S.speed + '×';
      document.getElementById('vox-speed-slider').value = S.speed;
      document.getElementById('vox-speed-val').textContent = label;
      document.getElementById('vox-speed-pill').textContent = label;
      savePrefs();
      if (S.speaking) { const i = S.currentWord; speakFrom(i); }
    };

    // Settings open/close — panel slides below bar, bar stays visible for dragging
    document.getElementById('vox-settings-btn').onclick = () => {
      S.settingsOpen = !S.settingsOpen;
      document.getElementById('vox-settings').classList.toggle('open', S.settingsOpen);
    };
    document.getElementById('vox-settings-close').onclick = () => {
      S.settingsOpen = false;
      document.getElementById('vox-settings').classList.remove('open');
    };

    // Speed slider — only restart on mouseup to avoid choppiness
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
      if (S.speaking) { const i = S.currentWord; speakFrom(i); }
    };

    // Voice — resume from position
    document.getElementById('vox-voice-select').onchange = (e) => {
      const v = window.speechSynthesis.getVoices().find(v => v.name === e.target.value);
      if (v) {
        S.voice = v; S.selectedVoiceName = v.name; savePrefs();
        if (S.speaking) { const i = S.currentWord; stop(false); speakFrom(i); }
      }
    };

    // Progress — scrub only on mouseup to avoid choppy replays
    const prog = document.getElementById('vox-progress');
    prog.oninput = () => { S.scrubbing = true; };
    prog.onchange = (e) => {
      if (!S.words.length) return;
      S.scrubbing = false;
      const idx = Math.floor((e.target.value / 1000) * (S.words.length - 1));
      S.currentWord = idx;
      if (S.speaking || S.paused) speakFrom(idx);
    };

    // Highlight toggles
    document.getElementById('tog-word').onclick = (e) => {
      S.highlightWord = !S.highlightWord;
      e.target.classList.toggle('on', S.highlightWord); savePrefs();
    };
    document.getElementById('tog-sentence').onclick = (e) => {
      S.highlightSentence = !S.highlightSentence;
      e.target.classList.toggle('on', S.highlightSentence); savePrefs();
    };

    // Highlight style
    document.getElementById('hl-bg').onclick = () => {
      S.sentenceStyle = 'bg';
      document.getElementById('hl-bg').classList.add('active');
      document.getElementById('hl-ul').classList.remove('active');
      applyColors(); savePrefs();
    };
    document.getElementById('hl-ul').onclick = () => {
      S.sentenceStyle = 'underline';
      document.getElementById('hl-ul').classList.add('active');
      document.getElementById('hl-bg').classList.remove('active');
      applyColors(); savePrefs();
    };

    // Hex color inputs
    function bindHex(inputId, previewId, setter) {
      const el = document.getElementById(inputId);
      const pv = document.getElementById(previewId);
      el.oninput = (e) => {
        let val = e.target.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
          pv.style.background = val;
          setter(val);
          applyColors(); savePrefs();
        }
      };
    }
    bindHex('hex-word','prev-word', v => S.wordColor = v);
    bindHex('hex-sentence','prev-sentence', v => S.sentenceHex = v);

    // Shortcuts
    document.getElementById('sc-save').onclick = () => {
      S.shortcuts.play = document.getElementById('sc-play').value || 'p';
      S.shortcuts.stop = document.getElementById('sc-stop').value || 's';
      S.shortcuts.read = document.getElementById('sc-read').value || 'r';
      savePrefs(); setStatus('Saved!');
    };

    // Export
    document.getElementById('exp-pdf').onclick = () => window.print();
    document.getElementById('exp-mp3').onclick = exportAudio;

    // Click-to-jump (only while speaking/paused)
    document.addEventListener('click', (e) => {
      if (!S.speaking && !S.paused) return;
      const sp = e.target.closest('.vox-word');
      if (!sp || sp.dataset.voxIndex == null) return;
      speakFrom(parseInt(sp.dataset.voxIndex));
    });

    // Draggable bar
    const bar = document.getElementById('vox-bar');
    bar.addEventListener('mousedown', (e) => {
      // Don't drag if clicking a button/input
      if (e.target.closest('button,input,select')) return;
      S.dragging = true;
      const rect = S.playerEl.getBoundingClientRect();
      S.dragOffsetX = e.clientX - rect.left;
      S.dragOffsetY = e.clientY - rect.top;
      // Switch from centered transform to absolute position
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
    if (btn) btn.textContent = (S.speaking && !S.paused) ? '⏸' : '▶';
  }

  function setStatus(text, active = false) {
    const el = document.getElementById('vox-status');
    if (el) { el.textContent = text; el.className = active ? 'playing' : ''; }
  }

  function updateProgress() {
    if (S.scrubbing) return;
    const el = document.getElementById('vox-progress');
    if (el && S.words.length > 1) {
      el.value = Math.floor((S.currentWord / (S.words.length - 1)) * 1000);
    }
  }

  // ── Message + keyboard ─────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'toggle_player') {
      loadPrefs(() => createPlayer());
    }
  });

  document.addEventListener('keydown', (e) => {
    const mod = e.altKey;  // always use Alt/Option on all platforms (Cmd conflicts with browser shortcuts)
    if (!mod) return;
    if (e.key === S.shortcuts.play) {
      e.preventDefault();
      if (!S.speaking) document.getElementById('vox-playpause-bar')?.click();
      else pauseResume();
    }
    if (e.key === S.shortcuts.stop) { e.preventDefault(); stop(true); }
    if (e.key === S.shortcuts.read) {
      e.preventDefault();
      const sel = window.getSelection(); const text = sel.toString().trim();
      if (text) { if (!document.getElementById('vox-player')) createPlayer(); handleSel(text, sel.anchorNode); }
    }
  });

  document.addEventListener('scroll', () => {
    if (!S.speaking) return;
    scheduleOverlayRefresh();
  }, true);
  window.addEventListener('resize', () => scheduleOverlayRefresh(), true);

})();
