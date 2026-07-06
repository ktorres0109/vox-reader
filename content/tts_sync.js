// KReader sync — Speechify-style in-page highlighting for the local
// KReader (tts-reader) mac app. Runs alongside Vox Reader's own TTS:
// this script only activates while the local app is reading (polls
// 127.0.0.1:8766/state) and stays dormant otherwise.
//
// Polls the local app (127.0.0.1:8766/state) for the sentence + word being
// spoken, finds that sentence in this page's text nodes, and paints native
// DOM highlights that scroll into view. One-way: position comes in, nothing
// about the page is ever sent out (the request carries no body or query).

(() => {
  const ENDPOINT = "http://127.0.0.1:8766/state";
  const POLL_ACTIVE_MS = 200;
  const POLL_IDLE_MS = 2000;

  const style = document.createElement("style");
  style.textContent = `
    .ttsr-sent { background: rgba(108, 93, 211, 0.16); border-radius: 3px; }
    .ttsr-word { background: rgba(108, 93, 211, 0.85); color: #fff;
                 border-radius: 3px; }
  `;
  document.documentElement.appendChild(style);

  const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();

  let pageMap = null;      // { text, nodes: [{node, start}] } lazily built
  let lastSeq = -1;
  let lastSentence = "";
  let lastSpan = "";
  let marked = [];         // wrapped <span>s to unwrap on change

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
    pageMap = null; // unwrapping changed the text nodes; rebuild next time
    // forget the dedupe key too — otherwise pause/resume (or a seq bump) on
    // the same sentence early-returns in highlight() and never repaints
    lastSentence = "";
    lastSpan = "";
  }

  function locate(offset) {
    // normalized page offset -> {node, approximate char offset in node}
    const nodes = pageMap.nodes;
    let lo = 0, hi = nodes.length - 1, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (nodes[mid].start <= offset) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    const entry = nodes[best];
    // map normalized offset back into the raw node text (whitespace runs
    // collapse to one char in the map, so walk the raw string in step)
    const raw = entry.node.textContent;
    let normPos = entry.start, rawPos = 0, inWs = true;
    // skip leading whitespace of the node (norm() trimmed it)
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
    } catch (e) {
      // range crosses element boundaries surroundContents can't wrap —
      // fall back to highlighting each intersected text node fully
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
    if (needle.length < 8) return; // too short to anchor reliably
    const at = pageMap.text.indexOf(needle);
    if (at < 0) return; // sentence not on this page — stay quiet
    const sentSpan = markRange(at, at + needle.length, "ttsr-sent");
    if (state.span) {
      // word offsets are within the raw sentence; normalized ≈ raw here.
      // norm() trims the prefix's trailing space, so add the separator back
      // or every word mark starts one char early and clips its last letter
      const prefix = norm(state.sentence.slice(0, state.span[0]));
      const w0 = prefix.length + (prefix ? 1 : 0);
      const w1 = w0 + Math.max(
        1, norm(state.sentence.slice(state.span[0], state.span[1])).length);
      pageMap = null; buildPageMap(); // sentence wrap changed node layout
      const at2 = pageMap.text.indexOf(needle);
      if (at2 >= 0) markRange(at2 + w0, at2 + w1, "ttsr-word");
    }
    const target = marked[marked.length - 1] || sentSpan;
    if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  let timer = null;
  async function poll() {
    let delay = POLL_IDLE_MS;
    try {
      const r = await fetch(ENDPOINT, { cache: "no-store" });
      const s = await r.json();
      if (s.seq !== lastSeq) { lastSeq = s.seq; clearMarks(); }
      if (s.active) { delay = POLL_ACTIVE_MS; highlight(s); }
      else if (marked.length) clearMarks();
    } catch (_) {
      if (marked.length) clearMarks(); // app closed; clean the page
    }
    timer = setTimeout(poll, delay);
  }
  poll();
})();
