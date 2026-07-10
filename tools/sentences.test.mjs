import assert from 'node:assert/strict';
import { buildSentences, getSentencesFrom } from './sentences.mjs';

const words = ['Hello', 'world.', 'This', 'is', 'a', 'test.'];
const sentences = buildSentences(words);

assert.deepEqual(sentences, [
  { start: 0, end: 1 },
  { start: 2, end: 5 },
]);

const full = getSentencesFrom(words, sentences, 0, words.length - 1);
assert.equal(full.length, 2);
assert.equal(full[0].text, 'Hello world.');
assert.equal(full[1].text, 'This is a test.');

const mid = getSentencesFrom(words, sentences, 3, words.length - 1);
assert.equal(mid.length, 1);
assert.equal(mid[0].text, 'is a test.');
assert.equal(mid[0].startWordIdx, 3);

const sel = getSentencesFrom(words, sentences, 0, 1);
assert.equal(sel.length, 1);
assert.equal(sel[0].text, 'Hello world.');

console.log('sentences.test.mjs: ok');
