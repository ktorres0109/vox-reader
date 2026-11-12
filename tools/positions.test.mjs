import assert from 'node:assert/strict';
import '../content/lib/positions.js';

const P = globalThis.VoxPositions;

assert.equal(P.pageKey('https://a.com/x?y=1#sec-2'), 'https://a.com/x?y=1');
assert.equal(P.pageKey('https://a.com/x'), 'https://a.com/x');

// LRU eviction keeps the newest `cap` entries
let map = {};
for (let i = 0; i < 5; i++) map = P.upsertPosition(map, `u${i}`, P.makeEntry(i, 10), 3, 1000 + i);
assert.deepEqual(Object.keys(map).sort(), ['u2', 'u3', 'u4']);
// Touching an old key refreshes it
map = P.upsertPosition(map, 'u2', P.makeEntry(5, 10), 3, 2000);
map = P.upsertPosition(map, 'u5', P.makeEntry(1, 10), 3, 2001);
assert.deepEqual(Object.keys(map).sort(), ['u2', 'u4', 'u5']);
assert.equal(map.u2.word, 5);
assert.equal(map.u2.at, 2000);
// Input map is not mutated
const before = { a: { at: 1 } };
P.upsertPosition(before, 'b', P.makeEntry(0, 2), 1, 5);
assert.deepEqual(before, { a: { at: 1 } });
assert.deepEqual(Object.keys(P.removePosition(map, 'u4')).sort(), ['u2', 'u5']);

// Entries and resume offer thresholds
const e = P.makeEntry(40, 101, 'some words');
assert.equal(e.pct, 0.4);
assert.equal(e.anchor, 'some words');
assert.ok(P.shouldOfferResume(e));
assert.ok(!P.shouldOfferResume(P.makeEntry(0, 100)));
assert.ok(!P.shouldOfferResume(P.makeEntry(99, 100)));
assert.ok(!P.shouldOfferResume(null));

// Mapping back onto a page whose word count changed
assert.equal(P.wordFromEntry(e, 101), 40);
assert.equal(P.wordFromEntry(e, 201), 80);
assert.equal(P.wordFromEntry(e, 0), 0);

console.log('positions.test.mjs: ok');
