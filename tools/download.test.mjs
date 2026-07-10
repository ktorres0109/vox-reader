import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'background/download.js'), 'utf8');

assert.match(src, /tryDownload\(true\)/, 'export download should retry with saveAs dialog');
assert.match(src, /function downloadAudioBlob/);

console.log('download.test.mjs: ok');
