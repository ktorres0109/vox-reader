// Vox Reader — per-page reading positions (pure helpers, no chrome.* calls).
// Stored in chrome.storage.local under POSITIONS_KEY as { [pageKey]: entry }.
// Loaded as a content script (globalThis.VoxPositions) and by tools/positions.test.mjs.

(function (root) {
  const POSITIONS_KEY = 'voxPositions';
  const MAX_ENTRIES = 200;
  const MIN_PCT = 0.02;
  const MAX_PCT = 0.98;

  /** Page identity: the URL without its #fragment. */
  function pageKey(href) {
    const s = String(href || '');
    const i = s.indexOf('#');
    return i >= 0 ? s.slice(0, i) : s;
  }

  /**
   * Insert/refresh one entry and evict the least recently used beyond `cap`.
   * @param {Record<string, {at:number}>} map existing positions (not mutated)
   * @returns {Record<string, object>} new map
   */
  function upsertPosition(map, key, entry, cap = MAX_ENTRIES, now = Date.now()) {
    const next = { ...(map || {}) };
    next[key] = { ...entry, at: now };
    const keys = Object.keys(next);
    if (keys.length > cap) {
      keys.sort((a, b) => (next[a].at || 0) - (next[b].at || 0));
      for (const k of keys.slice(0, keys.length - cap)) delete next[k];
    }
    return next;
  }

  function removePosition(map, key) {
    const next = { ...(map || {}) };
    delete next[key];
    return next;
  }

  /** Position entry for word `wordIdx` of `total`, with a short text anchor for re-finding it. */
  function makeEntry(wordIdx, total, anchor) {
    const denom = Math.max(1, total - 1);
    return { word: wordIdx, total, pct: Math.min(1, Math.max(0, wordIdx / denom)), anchor: anchor || '' };
  }

  function shouldOfferResume(entry) {
    return !!entry && typeof entry.pct === 'number' && entry.pct >= MIN_PCT && entry.pct <= MAX_PCT;
  }

  /** Map a saved entry onto the current page's word count (used when the anchor is not found). */
  function wordFromEntry(entry, total) {
    if (!entry || total <= 0) return 0;
    if (entry.total === total && entry.word < total) return entry.word;
    return Math.min(total - 1, Math.max(0, Math.round(entry.pct * (total - 1))));
  }

  root.VoxPositions = {
    POSITIONS_KEY, MAX_ENTRIES,
    pageKey, upsertPosition, removePosition, makeEntry, shouldOfferResume, wordFromEntry,
  };
})(globalThis);
