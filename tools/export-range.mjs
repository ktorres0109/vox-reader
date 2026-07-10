// Pure export range resolver (unit-tested)

/**
 * @param {{ scope: string, wordCount: number, currentWord?: number, speakEndIdx?: number|null, selectionStart?: number|null, selectionWordCount?: number }} opts
 * @returns {{ start: number, end: number } | null}
 */
export function resolveExportRange({
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
    if (end < start) return null;
    return { start, end };
  }

  return {
    start: 0,
    end: speakEndIdx != null ? Math.min(speakEndIdx, maxEnd) : maxEnd,
  };
}

export const MP3_BITRATES = [96, 128, 192];

export function normalizeMp3Bitrate(value) {
  const n = Number(value);
  return MP3_BITRATES.includes(n) ? n : 128;
}
