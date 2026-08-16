# Plan: Fix Kokoro "Failed to Fetch" — Patch transformers.min.js

## Context
Chrome MV3 `extension_pages` CSP doesn't allow hash-based whitelisting of inline scripts (only sandboxed pages). The importmap approach is dead end. Root cause confirmed: inside `transformers.min.js`, ORT initialization code overwrites `wasmPaths` to CDN URL, clobbering whatever we set in offscreen.js:

```javascript
w.wasm.wasmPaths=`https://cdn.jsdelivr.net/npm/@huggingface/transformers@${s.env.version}/dist/`
```

**All model and WASM files are already local** (vendor/models/ and vendor/wasm/). Zero CDN needed. Just need this override removed.

## What We're NOT Doing
- Importmap + CSP hash → MV3 blocks it
- numThreads=1 → loads wrong WASM variant (non-threaded, which we don't have)
- Any network downloading → everything is already bundled

## Fix (3 files)

### 1. `vendor/transformers.min.js` — patch CDN override (1 line change)
Find:
```
w.wasm.wasmPaths=`https://cdn.jsdelivr.net/npm/@huggingface/transformers@${s.env.version}/dist/`
```
Replace with no-op (preserves our local setting from offscreen.js):
```
w.wasm.wasmPaths=w.wasm.wasmPaths
```

### 2. `offscreen/offscreen.html` — remove importmap (already clean, just verify)
Should just be:
```html
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body><script type="module" src="offscreen.js"></script></body></html>
```

### 3. `manifest.json` — revert CSP (remove bad sha256)
Revert to: `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"`

## Why This Works
After patch:
1. `offscreen.js` sets `env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/wasm/')`
2. ORT init runs, hits patched no-op → our local path stays
3. ORT resolves `ort-wasm-simd-threaded.jsep.mjs` → `chrome-extension://[id]/vendor/wasm/ort-wasm-simd-threaded.jsep.mjs` ✓
4. `.mjs` loads `.wasm` from same dir → `chrome-extension://[id]/vendor/wasm/ort-wasm-simd-threaded.jsep.wasm` ✓
5. Model loads from `env.remoteHost` = `chrome-extension://[id]/vendor/models/` ✓
6. Zero CDN fetches

## Verification
Reload extension → open page → open player → switch to AI Neural → no "Failed to fetch" → voice works.
