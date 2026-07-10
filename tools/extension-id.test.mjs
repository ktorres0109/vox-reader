import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { unpackedExtensionId } from './extension-id.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = unpackedExtensionId(root);

assert.match(id, /^[a-p]{32}$/);
assert.equal(id, unpackedExtensionId(root));
assert.notEqual(id, unpackedExtensionId(path.join(root, 'other')));

console.log('extension-id.test.mjs: ok');
