import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smoke = fs.readFileSync(path.join(root, 'tests/e2e/smoke.spec.js'), 'utf8');
const count = (smoke.match(/^\s+test\(/gm) || []).length;

assert.ok(count >= 35, `expected at least 35 e2e smoke tests, found ${count}`);

console.log(`e2e-smoke-count.test.mjs: ok (${count} tests)`);
