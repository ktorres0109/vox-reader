// Vox Reader — text cleaning before speech (pure, no DOM).
// Loaded as a content script (sets globalThis.VoxTextClean) and imported by
// tools/text-clean.test.mjs. Works per token so the spoken text keeps a 1:1
// mapping to the displayed words: a token that should not be spoken maps to ''.

(function (root) {
  // Bracketed citation / editorial markers that fit inside one token: [12], [3–5], [a], [edit]
  const INLINE_CITE = /\[(?:\d{1,4}(?:\s*[,–—-]\s*\d{1,4})*|[a-z]|note\s*\d+|nb\s*\d+|edit|who\??|when\??|which\??|why\??|dubious|vague|citation needed)\]/gi;
  // Full bracket groups that may span several tokens: [citation needed], [according to whom?]
  const MULTI_CITE = /^\[(?:[a-z ]{0,30}needed|according to whom\??|by whom\??|failed verification|dead link|dubious\s*[–—-]?\s*discuss|original research\??|not in citation given|unreliable source\??|clarification|citation|edit)\]$/i;
  const URL_START = /^[("'<\[]*(?:https?:\/\/|www\.)/i;
  const SUPERSCRIPT = /[¹²³⁰⁴-ⁿ]+/g;
  // Superscript markers stripped only after punctuation or a word of 3+ letters
  // (keeps "m²", "cm³", "mc²").
  const TRAILING_SUPERSCRIPT = /([.,;:!?)"'”’]|[A-Za-z]{3,})[¹²³⁰⁴-⁹*†‡]+$/;

  /** Spoken form of a raw URL token: its host without "www.", plus trailing punctuation. */
  function urlToSpoken(token) {
    const s = String(token);
    const tailM = s.match(/[.,;:!?)"'>\]]*$/);
    const tail = (tailM ? tailM[0] : '').replace(/[)"'>\]]/g, '');
    const body = s.slice(0, s.length - (tailM ? tailM[0].length : 0));
    const m = body.match(/^[("'<\[]*(?:https?:\/\/)?(?:www\.)?([^/\s?#:'")>\]]+)/i);
    if (!m) return '';
    return m[1].replace(/\.+$/, '') + tail;
  }

  function cleanSingle(text) {
    let t = String(text || '');
    if (!t) return '';
    if (URL_START.test(t)) return urlToSpoken(t);
    t = t.replace(INLINE_CITE, '');
    t = t.replace(TRAILING_SUPERSCRIPT, '$1');
    // Lone superscript characters (a whole token like "¹")
    if (!t.replace(SUPERSCRIPT, '').trim()) return '';
    return t.trim();
  }

  /**
   * @param {Array<string | {text: string, footnote?: boolean}>} tokens displayed words
   * @returns {string[]} spoken form per token ('' = do not speak)
   */
  function cleanTokens(tokens) {
    const items = tokens.map((t) => (typeof t === 'string' ? { text: t } : t || { text: '' }));
    const out = new Array(items.length).fill(null);
    for (let i = 0; i < items.length; i++) {
      if (out[i] !== null) continue;
      const { text, footnote } = items[i];
      if (footnote) { out[i] = ''; continue; }
      const raw = String(text || '');
      // A bracket opened in this token and closed in a later one: [citation needed]
      const open = raw.lastIndexOf('[');
      if (open >= 0 && raw.indexOf(']', open) < 0 && !URL_START.test(raw)) {
        let joined = raw.slice(open);
        let closeAt = -1;
        for (let j = i + 1; j < Math.min(items.length, i + 6); j++) {
          joined += ' ' + String(items[j].text || '');
          if (String(items[j].text || '').includes(']')) { closeAt = j; break; }
        }
        if (closeAt > 0) {
          const last = String(items[closeAt].text || '');
          const cut = last.indexOf(']');
          const group = joined.slice(0, joined.length - (last.length - cut - 1));
          if (MULTI_CITE.test(group.replace(/\s+/g, ' '))) {
            out[i] = cleanSingle(raw.slice(0, open));
            for (let j = i + 1; j < closeAt; j++) out[j] = '';
            out[closeAt] = cleanSingle(last.slice(cut + 1));
            continue;
          }
        }
      }
      out[i] = cleanSingle(raw);
    }
    return out;
  }

  /** Clean a free-form string (e.g. text handed to Vox by another extension). */
  function cleanText(text) {
    const tokens = String(text || '').split(/\s+/).filter(Boolean);
    return cleanTokens(tokens).filter(Boolean).join(' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  }

  const api = { cleanTokens, cleanText, urlToSpoken };
  root.VoxTextClean = api;
})(globalThis);
