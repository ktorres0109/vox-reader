import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = path.join(root, 'dist', 'vox-reader.zip');

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

execSync('node tools/pack-extension.mjs', { cwd: root, stdio: 'pipe' });

assert.ok(fs.existsSync(zipPath), 'dist/vox-reader.zip should exist');
assert.ok(fs.statSync(zipPath).size > 10_000, 'zip should be non-trivial size');

console.log('pack.test.mjs: ok');
