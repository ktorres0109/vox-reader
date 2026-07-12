import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'background/download.js'), 'utf8');

const calls = [];
let changedListener = null;
let revoked = false;
const sandbox = {
  Blob: class Blob {},
  URL: {
    createObjectURL: () => 'blob:test',
    revokeObjectURL: () => { revoked = true; },
  },
  chrome: {
    runtime: { lastError: null },
    downloads: {
      download(options, callback) {
        calls.push(options);
        if (calls.length === 1) {
          sandbox.chrome.runtime.lastError = { message: 'automatic download blocked' };
          callback(undefined);
          sandbox.chrome.runtime.lastError = null;
        } else {
          callback(42);
        }
      },
      onChanged: {
        addListener(listener) { changedListener = listener; },
        removeListener(listener) {
          if (changedListener === listener) changedListener = null;
        },
      },
    },
  },
  setTimeout,
  clearTimeout,
  Uint8Array,
};
vm.runInNewContext(`${src}\nglobalThis.downloadAudioBlob = downloadAudioBlob;`, sandbox);
const id = await sandbox.downloadAudioBlob(new Uint8Array([1, 2]), 'audio.wav', 'audio/wav');

assert.equal(id, 42);
assert.deepEqual(calls.map((call) => call.saveAs), [false, true]);
assert.equal(revoked, false, 'blob should remain alive while the download is active');
changedListener({ id: 42, state: { current: 'complete' } });
assert.equal(revoked, true, 'blob should be revoked when Chrome reports completion');
assert.equal(changedListener, null, 'completion listener should be removed');

console.log('download.test.mjs: ok');
