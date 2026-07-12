#!/usr/bin/env node
/**
 * Pack Vox Reader for Chrome Web Store upload.
 * Usage: npm run pack
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const outZip = path.join(distDir, 'vox-reader.zip');

const required = [
  'manifest.json',
  'background/service_worker.js',
  'shared/core.js',
  'content/content.js',
  'popup/popup.html',
  'offscreen/offscreen.js',
];

const strict = process.argv.includes('--strict') || process.env.VOX_PACK_STRICT === '1';

const storeVendor = [
  'vendor/kokoro.web.js',
  'vendor/lame.min.js',
  'vendor/ort-wasm-simd-threaded.jsep.mjs',
  'vendor/ort-wasm-simd-threaded.jsep.wasm',
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`pack: missing required file ${file}`);
    process.exit(1);
  }
}

for (const file of storeVendor) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    const msg = `pack: missing ${file} — run npm run fetch-deps`;
    if (strict) {
      console.error(`pack: ${msg}`);
      process.exit(1);
    }
    console.warn(`pack: ${msg}`);
  }
}

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

const excludes = [
  'dist/*',
  'node_modules/*',
  '.git/*',
  'store-assets/*',
  'test-results/*',
  'playwright-report/*',
  'tests/*',
  'tools/*',
  'package-lock.json',
  'package.json',
  'playwright.config.js',
  '.github/*',
  '*.md',
  '.gitignore',
];

const excludeArgs = excludes.map((x) => `-x '${x}'`).join(' ');

try {
  execSync(
    `cd "${root}" && zip -r "${outZip}" . ${excludeArgs}`,
    { stdio: 'inherit', shell: '/bin/bash' },
  );
} catch (err) {
  console.error('pack: zip failed — install zip utility');
  process.exit(1);
}

const size = fs.statSync(outZip).size;
console.log(`pack: wrote ${outZip} (${(size / 1024 / 1024).toFixed(2)} MB)`);
