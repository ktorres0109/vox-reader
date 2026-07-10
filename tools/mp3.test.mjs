import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lamePath = path.join(root, 'vendor/lame.min.js');

if (!fs.existsSync(lamePath)) {
  console.warn('mp3.test.mjs: skipped — vendor/lame.min.js missing (run npm run fetch-deps)');
  process.exit(0);
}

const script = fs.readFileSync(lamePath, 'utf8');
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(script, sandbox);
globalThis.lamejs = sandbox.lamejs;

const { encodeMp3 } = await import('../offscreen/mp3.js');

const samples = new Float32Array(4800);
for (let i = 0; i < samples.length; i++) {
  samples[i] = Math.sin((2 * Math.PI * 440 * i) / 24000) * 0.25;
}

const mp3 = encodeMp3(samples, 24000, 128);
const bytes = new Uint8Array(mp3);

assert.ok(bytes.length > 100, 'MP3 output should not be empty');
const frameSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
assert.ok(frameSync || id3, 'MP3 should start with frame sync or ID3 tag');

console.log('mp3.test.mjs: ok');
