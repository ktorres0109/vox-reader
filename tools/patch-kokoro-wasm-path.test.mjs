import assert from 'node:assert/strict';
import { patchSource, LOCAL } from './patch-kokoro-wasm-path.mjs';

const sample = 'a;C.wasm.wasmPaths=`https://cdn.jsdelivr.net/npm/@huggingface/transformers@${n.env.version}/dist/`,C.wasm.proxy=!1;';
const once = patchSource(sample);
assert.ok(once.changed);
assert.ok(once.src.includes(LOCAL));
assert.ok(!once.src.includes('cdn.jsdelivr.net'));
assert.equal(patchSource(once.src).changed, false);
assert.throws(() => patchSource('no pattern here'));

console.log('patch-kokoro-wasm-path.test.mjs: ok');
