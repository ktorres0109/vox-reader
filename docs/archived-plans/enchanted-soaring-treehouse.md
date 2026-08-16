# Vox Reader — Selection-to-Read + Highlighting Fix + Cleanup

## Context
User wants:
1. Selecting text starts reading from that point onward (not just reading the isolated chunk)
2. Word + sentence highlighting work when reading from a selected position
3. Remove debug cruft (all `debugLog` / `#region agent log` blocks)

## Root Cause Analysis

### Bug 1: Selection doesn't start full-page read with highlighting
`handleSel` (line 634):
- Short selection (≤4 words): walks up from `anchor` to find `.vox-word`, calls `speakFrom(idx)` → **should work if words already wrapped**
- Long selection (>4 words): always calls `readChunk(text)` → reads the selected chunk only, no word/sentence highlighting at all
- If words NOT wrapped: the while-loop walk finds no `.vox-word`, falls through to `readChunk` regardless of length

### Bug 2: Anchor not found when words unwrapped
When words aren't wrapped yet, `anchor` is a raw text node inside an un-wrapped element. The walk `while (el && !el.classList?.contains('vox-word'))` walks all the way to null. No fallback to rewrap+find.

### Bug 3: After rewrap, old anchor is detached
The `rewrap(doSpeak)` path in current code only triggers if `el` has `voxIndex` (which is never true when words aren't wrapped). Dead code path.

## Fix Plan

### 1. Rewrite `handleSel` (content.js lines 634–646)

New logic — always try to start full-page read via `speakFrom`:

```js
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

  // Words not wrapped — rewrap then find by text (anchor is detached post-rewrap)
  rewrap(() => {
    const idx = findByText(selText);
    speakFrom(idx >= 0 ? idx : 0);
  });
}
```

This replaces both the short/long selection split and the broken rewrap path.

### 2. Remove all debug logging

Strip:
- `debugLog` function definition (lines 6–8)
- All `// #region agent log … // #endregion` blocks (11 blocks across the file)
- `S.debugScrollLogCount` field and the scroll log guard (line 1075–1076)
- The `sessionId/runId/hypothesisId` log calls in: `narrowChatRootExcludingMap`, `getRoot`, `highlightAt`, `placeSentenceOverlays`, `onMessage toggle_player`

### 3. Remove dead `readChunk` (lines 648–656)
No longer called after `handleSel` rewrite. Delete it.

## Critical Files
- `/Users/kel/Documents/projects/Vox Reader/content/content.js` — all changes here

## Verification
1. Load extension in Chrome, navigate to any article
2. Open Vox player
3. Highlight a word or phrase mid-article → play → should start reading from that word with word+sentence highlight tracking
4. Highlight with words not yet wrapped (fresh page, first selection) → should rewrap then start from selected word
5. Word highlight (amber background) moves with speech
6. Sentence highlight updates sentence-by-sentence
7. No console errors, no debug messages in background worker
