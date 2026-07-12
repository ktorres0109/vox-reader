import assert from 'node:assert/strict';
import '../shared/core.js';

const { filterChatRoots, normalizeChatReadScope } = globalThis.VoxCore;

const roots = ['a', 'b', 'c'];

assert.deepEqual(filterChatRoots(roots, 'all'), roots);
assert.deepEqual(filterChatRoots(roots, 'latest'), ['c']);
assert.deepEqual(filterChatRoots(roots, 'single', 1), ['b']);
assert.deepEqual(filterChatRoots(roots, 'single', 99), ['c']);
assert.equal(normalizeChatReadScope('latest'), 'latest');
assert.equal(normalizeChatReadScope('bogus'), 'all');

console.log('chat-read-scope.test.mjs: ok');
