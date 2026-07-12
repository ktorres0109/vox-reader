import assert from 'node:assert/strict';
import { loadServiceWorker } from './service-worker-harness.mjs';

const { listeners, sent, createdMenus } = loadServiceWorker();

listeners.installed({ reason: 'update' });
assert.deepEqual(JSON.parse(JSON.stringify(createdMenus)), [{
  id: 'vox-read-selection',
  title: 'Read selection with Vox Reader',
  contexts: ['selection'],
}]);

listeners.contextClicked(
  { menuItemId: 'vox-read-selection', selectionText: '  chosen words  ' },
  { id: 9 },
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{
  tabId: 9,
  message: { action: 'read_selection', text: 'chosen words' },
}]);

console.log('context-menu.test.mjs: ok');
