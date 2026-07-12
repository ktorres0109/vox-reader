(function (root) {
  'use strict';

  function buildSentences(words) {
    const sentences = [];
    if (!words.length) return sentences;
    let start = 0;
    for (let i = 0; i < words.length; i++) {
      if (/[.!?]["')\]]*$/.test(words[i]) && words[i].length > 1) {
        sentences.push({ start, end: i });
        start = i + 1;
      }
    }
    if (start < words.length) sentences.push({ start, end: words.length - 1 });
    return sentences;
  }

  function getSentenceIdx(sentences, wordIdx) {
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      if (wordIdx >= sentence.start && wordIdx <= sentence.end) return i;
    }
    return -1;
  }

  function getSentencesFrom(words, sentences, startIdx, endIdx) {
    let startSi = getSentenceIdx(sentences, startIdx);
    if (startSi < 0) startSi = 0;
    const cap = endIdx != null ? endIdx : words.length - 1;
    const result = [];
    for (let si = startSi; si < sentences.length; si++) {
      const { start, end } = sentences[si];
      if (start > cap) break;
      const wordStart = si === startSi ? Math.max(start, startIdx) : start;
      const wordEnd = Math.min(end, cap);
      if (wordStart > wordEnd) continue;
      const text = words.slice(wordStart, wordEnd + 1).join(' ');
      if (text.trim()) result.push({ text, startWordIdx: wordStart });
    }
    return result;
  }

  function filterChatRoots(roots, scope, index = 0) {
    if (!roots?.length) return roots || [];
    if (scope === 'latest') return [roots[roots.length - 1]];
    if (scope === 'single') {
      const i = Math.min(Math.max(0, index), roots.length - 1);
      return [roots[i]];
    }
    return roots;
  }

  function normalizeChatReadScope(value) {
    return value === 'latest' || value === 'single' ? value : 'all';
  }

  function resolveExportRange({
    scope,
    wordCount,
    currentWord = 0,
    speakEndIdx = null,
    selectionStart = null,
    selectionWordCount = 0,
  }) {
    if (wordCount < 1) return null;
    const maxEnd = wordCount - 1;
    if (scope === 'selection') {
      if (selectionStart == null || selectionStart < 0 || selectionWordCount < 1) return null;
      return {
        start: selectionStart,
        end: Math.min(selectionStart + selectionWordCount - 1, maxEnd),
      };
    }
    if (scope === 'here') {
      const start = Math.min(Math.max(0, currentWord), maxEnd);
      const end = speakEndIdx != null ? Math.min(speakEndIdx, maxEnd) : maxEnd;
      return end < start ? null : { start, end };
    }
    return {
      start: 0,
      end: speakEndIdx != null ? Math.min(speakEndIdx, maxEnd) : maxEnd,
    };
  }

  const MP3_BITRATES = [96, 128, 192];
  function normalizeMp3Bitrate(value) {
    const n = Number(value);
    return MP3_BITRATES.includes(n) ? n : 128;
  }

  root.VoxCore = {
    buildSentences,
    getSentencesFrom,
    filterChatRoots,
    normalizeChatReadScope,
    resolveExportRange,
    MP3_BITRATES,
    normalizeMp3Bitrate,
  };
})(globalThis);
