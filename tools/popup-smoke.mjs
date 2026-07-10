import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const popupHtml = fs.readFileSync(path.join(root, 'popup/popup.html'), 'utf8');
assert.match(popupHtml, /id="open-player"/);
assert.match(popupHtml, /id="read-selection"/);
assert.match(popupHtml, /id="sc-export-display"/);
assert.match(popupHtml, /id="privacy-link"/);
assert.match(popupHtml, /id="popup-version"/);

const popupJs = fs.readFileSync(path.join(root, 'popup/popup.js'), 'utf8');
assert.match(popupJs, /toggle_player/);
assert.match(popupJs, /read_selection/);
assert.match(popupJs, /getManifest/);
assert.match(popupJs, /privacy\.html/);

console.log('popup-smoke.mjs: ok');
