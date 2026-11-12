// Vox Reader — pure playback helpers: sentence navigation and time-left estimates.
// Loaded as a content script (globalThis.VoxPlayback) and by tools/playback-math.test.mjs.

(function (root) {
  const BASE_CPS = 13; // estimated spoken characters per second at 1.0x

  /** Index of the sentence containing wordIdx (sentences sorted, contiguous). -1 if none. */
  function sentenceIndexAt(sentences, wordIdx) {
    let lo = 0;
    let hi = sentences.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = sentences[mid];
      if (wordIdx < s.start) hi = mid - 1;
      else if (wordIdx > s.end) lo = mid + 1;
      else return mid;
    }
    return -1;
  }

  /**
   * Word index to jump to for "previous sentence". Restarts the current sentence
   * unless we are already at (or within `grace` words of) its start.
   */
  function prevSentenceStart(sentences, wordIdx, minIdx = 0, grace = 1) {
    const si = sentenceIndexAt(sentences, wordIdx);
    if (si < 0) return Math.max(minIdx, 0);
    const cur = sentences[si];
    if (wordIdx - cur.start > grace || si === 0) return Math.max(minIdx, cur.start);
    return Math.max(minIdx, sentences[si - 1].start);
  }

  /** Word index to jump to for "next sentence"; null when already in the last one. */
  function nextSentenceStart(sentences, wordIdx, maxIdx = Infinity) {
    const si = sentenceIndexAt(sentences, wordIdx);
    const next = sentences[si + 1];
    if (!next || next.start > maxIdx) return null;
    return next.start;
  }

  /** Seconds left given remaining spoken characters and playback speed. */
  function secondsLeft(charsLeft, speed = 1) {
    return Math.max(0, charsLeft) / (BASE_CPS * Math.max(0.25, speed || 1));
  }

  /** "12 min left", "<1 min left", "1 h 5 min left" */
  function formatTimeLeft(seconds) {
    const mins = Math.round(seconds / 60);
    if (seconds < 45) return '<1 min left';
    if (mins < 60) return `${Math.max(1, mins)} min left`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h} h ${m} min left` : `${h} h left`;
  }

  root.VoxPlayback = {
    BASE_CPS, sentenceIndexAt, prevSentenceStart, nextSentenceStart, secondsLeft, formatTimeLeft,
  };
})(globalThis);
