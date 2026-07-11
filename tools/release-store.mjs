#!/usr/bin/env node
/**
 * Build a store-ready zip and print submission checklist.
 * Usage: npm run release:store
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const zipPath = path.join(root, 'dist', 'vox-reader.zip');

execSync('npm run pack:store', { cwd: root, stdio: 'inherit' });

const sizeMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2);
const smoke = fs.readFileSync(path.join(root, 'tests/e2e/smoke.spec.js'), 'utf8');
const e2eCount = (smoke.match(/^\s+test\(/gm) || []).length;

console.log('');
console.log(`Vox Reader v${manifest.version} — store build ready`);
console.log(`  Zip: dist/vox-reader.zip (${sizeMb} MB)`);
console.log(`  E2e smoke tests: ${e2eCount}`);
console.log('');
console.log('Next steps:');
console.log('  1. npm run capture:store     → store-assets/*.png');
console.log('  2. Upload dist/vox-reader.zip to Chrome Web Store');
console.log('  3. Privacy URL: https://ktorres0109.github.io/vox-reader/privacy.html');
console.log('  4. Copy listing text from STORE_LISTING.md');
console.log('  5. Remap shortcuts at chrome://extensions/shortcuts if needed');
console.log('  6. Verify privacy page: https://ktorres0109.github.io/vox-reader/privacy.html');
console.log('  7. Run npm test && npm run test:e2e locally if changing playback/export');
