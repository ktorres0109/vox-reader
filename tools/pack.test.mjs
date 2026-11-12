import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = path.join(root, 'dist', 'vox-reader.zip');

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

execSync('node tools/pack-extension.mjs --strict', { cwd: root, stdio: 'pipe' });

assert.ok(fs.existsSync(zipPath), 'dist/vox-reader.zip should exist');
assert.ok(fs.statSync(zipPath).size > 10_000, 'zip should be non-trivial size');

const listing = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf8' });
assert.ok(!listing.includes('tests/fixtures'), 'zip should not include test fixtures');
assert.ok(!listing.includes('.DS_Store'), 'zip should not include macOS metadata');
assert.ok(!listing.includes('.cursor/'), 'zip should not include editor configuration');
assert.ok(listing.includes('manifest.json'), 'zip should include manifest.json');

const packed = JSON.parse(execSync(`unzip -p "${zipPath}" manifest.json`, { encoding: 'utf8' }));
assert.equal(packed.key, undefined, 'store zip must not carry the dev-only manifest key');
assert.equal(packed.version, JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version);

console.log('pack.test.mjs: ok');
