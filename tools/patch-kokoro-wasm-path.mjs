#!/usr/bin/env node
// Point kokoro.web.js's ONNX Runtime wasmPaths at the bundle's own directory
// instead of cdn.jsdelivr.net. Idempotent. Usage: node tools/patch-kokoro-wasm-path.mjs vendor/kokoro.web.js
import fs from 'node:fs';

export const CDN_PATTERN = /wasmPaths=`https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@\$\{[A-Za-z_$][\w$]*\.env\.version\}\/dist\/`/;
export const LOCAL = 'wasmPaths=new URL("./",import.meta.url).href';

export function patchSource(src) {
  if (src.includes(LOCAL)) return { src, changed: false };
  if (!CDN_PATTERN.test(src)) throw new Error('kokoro.web.js: CDN wasmPaths pattern not found (bundle version changed?)');
  return { src: src.replace(CDN_PATTERN, LOCAL), changed: true };
}

if (process.argv[1] && process.argv[1].endsWith('patch-kokoro-wasm-path.mjs')) {
  const file = process.argv[2];
  const { src, changed } = patchSource(fs.readFileSync(file, 'utf8'));
  if (changed) fs.writeFileSync(file, src);
  console.log(`patch-kokoro-wasm-path: ${changed ? 'patched' : 'already local'} ${file}`);
}
