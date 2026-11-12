import assert from 'node:assert/strict';
import '../content/lib/playback-math.js';

const P = globalThis.VoxPlayback;
const sentences = [{ start: 0, end: 4 }, { start: 5, end: 9 }, { start: 10, end: 12 }];

assert.equal(P.sentenceIndexAt(sentences, 0), 0);
assert.equal(P.sentenceIndexAt(sentences, 7), 1);
assert.equal(P.sentenceIndexAt(sentences, 12), 2);
assert.equal(P.sentenceIndexAt(sentences, 13), -1);
assert.equal(P.sentenceIndexAt([], 0), -1);

// Back: mid-sentence restarts it, at the start goes to the previous one
assert.equal(P.prevSentenceStart(sentences, 8), 5);
assert.equal(P.prevSentenceStart(sentences, 5), 0);
assert.equal(P.prevSentenceStart(sentences, 2), 0);
assert.equal(P.prevSentenceStart(sentences, 10, 6), 6); // bounded read keeps its start

// Forward
assert.equal(P.nextSentenceStart(sentences, 2), 5);
assert.equal(P.nextSentenceStart(sentences, 11), null);
assert.equal(P.nextSentenceStart(sentences, 6, 9), null); // next starts past the read range

// Time left
assert.equal(P.secondsLeft(130, 1), 10);
assert.equal(P.secondsLeft(130, 2), 5);
assert.equal(P.secondsLeft(-5, 1), 0);
assert.equal(P.formatTimeLeft(10), '<1 min left');
assert.equal(P.formatTimeLeft(60), '1 min left');
assert.equal(P.formatTimeLeft(12 * 60 + 10), '12 min left');
assert.equal(P.formatTimeLeft(65 * 60), '1 h 5 min left');
assert.equal(P.formatTimeLeft(120 * 60), '2 h left');

console.log('playback-math.test.mjs: ok');
