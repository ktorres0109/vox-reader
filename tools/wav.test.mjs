import { encodeWav } from '../offscreen/wav.js';
import assert from 'node:assert/strict';

const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
const wav = encodeWav(samples, 24000);
const view = new DataView(wav);

assert.equal(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)), 'RIFF');
assert.equal(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)), 'WAVE');
assert.equal(view.getUint32(24, true), 24000);
assert.equal(view.getUint32(40, true), samples.length * 2);
assert.equal(wav.byteLength, 44 + samples.length * 2);

console.log('wav.test.mjs: ok');
