import assert from 'node:assert/strict';
import '../shared/core.js';

const { normalizeMp3Bitrate, resolveExportRange } = globalThis.VoxCore;

assert.deepEqual(resolveExportRange({ scope: 'all', wordCount: 100 }), { start: 0, end: 99 });
assert.deepEqual(
  resolveExportRange({ scope: 'all', wordCount: 100, speakEndIdx: 40 }),
  { start: 0, end: 40 },
);
assert.deepEqual(
  resolveExportRange({ scope: 'here', wordCount: 100, currentWord: 25 }),
  { start: 25, end: 99 },
);
assert.deepEqual(
  resolveExportRange({ scope: 'here', wordCount: 100, currentWord: 25, speakEndIdx: 50 }),
  { start: 25, end: 50 },
);
assert.deepEqual(
  resolveExportRange({
    scope: 'selection',
    wordCount: 100,
    selectionStart: 10,
    selectionWordCount: 5,
  }),
  { start: 10, end: 14 },
);
assert.equal(resolveExportRange({ scope: 'selection', wordCount: 10, selectionStart: -1 }), null);
assert.equal(normalizeMp3Bitrate(192), 192);
assert.equal(normalizeMp3Bitrate(64), 128);

console.log('export-range.test.mjs: ok');
