import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const sw = fs.readFileSync(path.join(root, 'background/service_worker.js'), 'utf8');

const required = ['toggle-player', 'stop-reading', 'read-selection', 'export-audio'];
for (const id of required) {
  assert.ok(manifest.commands?.[id], `manifest missing command: ${id}`);
  assert.ok(manifest.commands[id].description, `command ${id} needs description`);
  assert.ok(manifest.commands[id].suggested_key?.default, `command ${id} needs suggested_key`);
}

assert.match(sw, /chrome\.commands\.onCommand/);
assert.match(sw, /command_play_pause/);

console.log('manifest-commands.test.mjs: ok');
