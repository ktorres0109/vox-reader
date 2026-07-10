// KReader sync — optional highlight sync for the local KReader mac app.
// Disabled by default; enable in Vox Reader Settings → KReader sync.

(() => {
  if (window.__voxKreaderSyncLoaded) return;
  window.__voxKreaderSyncLoaded = true;

  const ENDPOINT = "http://127.0.0.1:8766/state";
  const POLL_ACTIVE_MS = 200;
  const PROBE_INTERVAL_MS = 30000;
  const PROBE_TIMEOUT_MS = 1500;
  const SYNC_EVENT = "vox-kreader-sync";

  let styleEl = null;
  let active = false;
  let appAvailable = false;
  let timer = null;
  let pageMap = null;
  let lastSeq = -1;
  let lastSentence = "";
  let lastSpan = "";
  let marked = [];

  const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

  function ensureStyle() {
    if (styleEl) return;
    styleEl = document.createElement("style");
    styleEl.textContent = `
      .ttsr-sent { background: rgba(108, 93, 211, 0.16); border-radius: 3px; }
      .ttsr-word { background: rgba(108, 93, 211, 0.85); color: #fff;
                   border-radius: 3px; }
    `;
    document.documentElement.appendChild(styleEl);
  }

  function removeStyle() {
    if (styleEl) { styleEl.remove(); styleEl = null; }
  }

  function buildPageMap() {
    const walker = document.createTreeWalker(
      document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const p = n.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          const tag = p.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT")
            return NodeFilter.FILTER_REJECT;
          return n.textContent.trim()
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
    let text = "", nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ node: n, start: text.length });
      text += norm(n.textContent) + " ";
    }
    pageMap = { text, nodes };
  }

  function clearMarks() {
    for (const span of marked) {
      const parent = span.parentNode;
      if (!parent) continue;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    }
    marked = [];
    pageMap = null;
    lastSentence = "";
    lastSpan = "";
  }

  function locate(offset) {
    const nodes = pageMap.nodes;
    let lo = 0, hi = nodes.length - 1, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (nodes[mid].start <= offset) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    const entry = nodes[best];
    const raw = entry.node.textContent;
    let normPos = entry.start, rawPos = 0, inWs = true;
    while (rawPos < raw.length && /\s/.test(raw[rawPos])) rawPos++;
    inWs = false;
    while (rawPos < raw.length && normPos < offset) {
      if (/\s/.test(raw[rawPos])) {
        if (!inWs) { normPos++; inWs = true; }
      } else { normPos++; inWs = false; }
      rawPos++;
    }
    return { node: entry.node, offset: Math.min(rawPos, raw.length) };
  }

  function markRange(startOff, endOff, cls) {
    try {
      const a = locate(startOff), b = locate(endOff);
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      const span = document.createElement("span");
      span.className = cls;
      range.surroundContents(span);
      marked.push(span);
      return span;
    } catch (_) {
      return null;
    }
  }

  function highlight(state) {
    const key = state.sentence + "|" + JSON.stringify(state.span);
    if (key === lastSentence + "|" + lastSpan) return;
    clearMarks();
    lastSentence = state.sentence;
    lastSpan = JSON.stringify(state.span);
    if (!state.sentence) return;
    if (!pageMap) buildPageMap();
    const needle = norm(state.sentence);
    if (needle.length < 8) return;
    const at = pageMap.text.indexOf(needle);
    if (at < 0) return;
    const sentSpan = markRange(at, at + needle.length, "ttsr-sent");
    if (state.span) {
      const prefix = norm(state.sentence.slice(0, state.span[0]));
      const w0 = prefix.length + (prefix ? 1 : 0);
      const w1 = w0 + Math.max(
        1, norm(state.sentence.slice(state.span[0], state.span[1])).length);
      pageMap = null; buildPageMap();
      const at2 = pageMap.text.indexOf(needle);
      if (at2 >= 0) markRange(at2 + w0, at2 + w1, "ttsr-word");
    }
    const target = marked[marked.length - 1] || sentSpan;
    if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  async function probeApp() {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      const r = await fetch(ENDPOINT, { cache: "no-store", signal: ctrl.signal });
      clearTimeout(timeout);
      await r.json();
      appAvailable = true;
      return true;
    } catch (_) {
      appAvailable = false;
      return false;
    }
  }

  function scheduleProbe() {
    if (!active || timer) return;
    timer = setTimeout(async () => {
      timer = null;
      if (!active) return;
      if (await probeApp()) poll();
      else scheduleProbe();
    }, PROBE_INTERVAL_MS);
  }

  async function poll() {
    if (!active) return;
    let delay = POLL_ACTIVE_MS;
    try {
      const r = await fetch(ENDPOINT, { cache: "no-store" });
      const s = await r.json();
      appAvailable = true;
      if (s.seq !== lastSeq) { lastSeq = s.seq; clearMarks(); }
      if (s.active) { delay = POLL_ACTIVE_MS; highlight(s); }
      else if (marked.length) clearMarks();
    } catch (_) {
      appAvailable = false;
      if (marked.length) clearMarks();
      scheduleProbe();
      return;
    }
    if (active) timer = setTimeout(poll, delay);
  }

  function stop() {
    active = false;
    if (timer) { clearTimeout(timer); timer = null; }
    clearMarks();
    removeStyle();
    appAvailable = false;
    lastSeq = -1;
  }

  async function start() {
    if (active) return;
    active = true;
    ensureStyle();
    if (await probeApp()) poll();
    else scheduleProbe();
  }

  function setEnabled(enabled) {
    if (enabled) start();
    else stop();
  }

  window.addEventListener(SYNC_EVENT, (e) => {
    setEnabled(!!e.detail?.enabled);
  });

  document.addEventListener("visibilitychange", () => {
    if (!active || document.visibilityState !== "visible" || appAvailable || timer) return;
    probeApp().then((ok) => { if (ok && active && !timer) poll(); });
  });

  chrome.storage.sync.get({ kreaderSync: false }, (prefs) => {
    if (prefs.kreaderSync) start();
  });
})();
