import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServiceWorker } from './service-worker-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const required = ['toggle-player', 'stop-reading', 'read-selection', 'export-audio'];
for (const id of required) {
  assert.ok(manifest.commands?.[id], `manifest missing command: ${id}`);
  assert.ok(manifest.commands[id].description, `command ${id} needs description`);
  assert.ok(manifest.commands[id].suggested_key?.default, `command ${id} needs suggested_key`);
}

const expectedActions = {
  'toggle-player': 'command_play_pause',
  'stop-reading': 'command_stop',
  'read-selection': 'read_selection',
  'export-audio': 'command_export',
};
for (const [commandName, action] of Object.entries(expectedActions)) {
  const { listeners, sent } = loadServiceWorker();
  await listeners.command(commandName);
  assert.equal(sent.at(-1)?.message.action, action, `${commandName} should dispatch ${action}`);
  if (commandName === 'read-selection') {
    assert.equal(sent.at(-1)?.message.text, 'selected text');
  }
}

console.log('manifest-commands.test.mjs: ok');
