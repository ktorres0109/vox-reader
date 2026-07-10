import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sw = fs.readFileSync(path.join(root, 'background/service_worker.js'), 'utf8');

assert.match(sw, /vox-read-selection/);
assert.match(sw, /contextMenus\.create/);
assert.match(sw, /read_selection/);

console.log('context-menu.test.mjs: ok');
