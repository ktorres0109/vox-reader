// Sentence segmentation helpers (shared with tests)

export function buildSentences(words) {
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
    const s = sentences[i];
    if (wordIdx >= s.start && wordIdx <= s.end) return i;
  }
  return -1;
}

export function getSentencesFrom(words, sentences, startIdx, endIdx) {
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
