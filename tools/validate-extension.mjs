import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.version, 'manifest version required');
assert.ok(manifest.background?.service_worker);

const required = [
  'background/service_worker.js',
  'background/download.js',
  'content/content.js',
  'content/content.css',
  'content/tts_sync.js',
  'offscreen/offscreen.js',
  'offscreen/offscreen.html',
  'offscreen/wav.js',
  'popup/popup.html',
  'popup/popup.js',
  'tools/fetch-deps.sh',
  'tools/run-tests.sh',
];

for (const file of required) {
  assert.ok(fs.existsSync(path.join(root, file)), `missing required file: ${file}`);
}

const optionalVendor = path.join(root, 'vendor/kokoro.web.js');
if (!fs.existsSync(optionalVendor)) {
  console.warn('validate-extension: vendor/kokoro.web.js missing — run npm run fetch-deps');
}

console.log(`validate-extension.mjs: ok (v${manifest.version})`);
