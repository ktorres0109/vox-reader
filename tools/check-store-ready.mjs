#!/usr/bin/env node
/**
 * Pre-submit checklist for Chrome Web Store packaging.
 * Usage: npm run check:store
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.equal(manifest.version, pkg.version, 'manifest and package.json versions must match');
assert.ok(manifest.minimum_chrome_version, 'minimum_chrome_version required');

for (const size of [16, 48, 128]) {
  const icon = path.join(root, `icons/icon${size}.png`);
  assert.ok(fs.existsSync(icon), `missing icons/icon${size}.png`);
  assert.ok(fs.statSync(icon).size > 0, `icons/icon${size}.png is empty`);
}

for (const doc of ['docs/privacy.html', 'docs/index.html', 'STORE_LISTING.md', 'PRIVACY.md']) {
  assert.ok(fs.existsSync(path.join(root, doc)), `missing ${doc}`);
}

const listing = fs.readFileSync(path.join(root, 'STORE_LISTING.md'), 'utf8');
assert.match(listing, /github\.io\/vox-reader\/privacy\.html/, 'STORE_LISTING privacy URL should point at GitHub Pages');

const popupHtml = fs.readFileSync(path.join(root, 'popup/popup.html'), 'utf8');
assert.match(popupHtml, /privacy-link/, 'popup should link to privacy policy');

for (const id of ['toggle-player', 'stop-reading', 'read-selection', 'export-audio']) {
  assert.ok(manifest.commands?.[id], `manifest missing command: ${id}`);
}

for (const size of ['16', '48', '128']) {
  assert.equal(manifest.icons?.[size], `icons/icon${size}.png`, `manifest.icons.${size} mismatch`);
}

const vendorFiles = [
  'vendor/kokoro.web.js',
  'vendor/lame.min.js',
  'vendor/ort-wasm-simd-threaded.jsep.mjs',
  'vendor/ort-wasm-simd-threaded.jsep.wasm',
];
const missingVendor = vendorFiles.filter((f) => !fs.existsSync(path.join(root, f)));
if (missingVendor.length) {
  console.warn(`check-store-ready: vendor missing (${missingVendor.join(', ')}) — run npm run fetch-deps before pack:store`);
}

console.log(`check-store-ready.mjs: ok (v${manifest.version})`);
