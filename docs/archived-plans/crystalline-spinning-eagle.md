# Vox Reader — Fix AI Neural Voice (Local Model Bundling)

## Context
Runtime CDN download for model files keeps failing in the offscreen document context.
Previous attempts: `onnx-community/Kokoro-82M-v1.0` (404s), `Xenova/vits-ljspeech` (download stalling/failing).
Root cause: relying on HuggingFace CDN fetch at runtime from an extension offscreen doc is unreliable.
Fix: download model files ONCE via `fetch-deps.sh` into `vendor/models/`, point transformers.js to the local path.
No more runtime download. Extension works offline immediately after `fetch-deps.sh` is run.

---

## What Changes

### 1. `tools/fetch-deps.sh`
Add section to download all model files for `Xenova/vits-ljspeech` to `vendor/models/`:
```sh
MODEL_DIR="$VENDOR/models/Xenova/vits-ljspeech"
mkdir -p "$MODEL_DIR/onnx"
BASE="https://huggingface.co/Xenova/vits-ljspeech/resolve/main"

echo "Downloading vits-ljspeech model files..."
curl -#L "$BASE/config.json"              -o "$MODEL_DIR/config.json"
curl -#L "$BASE/tokenizer.json"           -o "$MODEL_DIR/tokenizer.json"
curl -#L "$BASE/tokenizer_config.json"    -o "$MODEL_DIR/tokenizer_config.json"
curl -#L "$BASE/vocab.json"               -o "$MODEL_DIR/vocab.json"
curl -#L "$BASE/onnx/model_quantized.onnx" -o "$MODEL_DIR/onnx/model_quantized.onnx"
```
Total: ~9MB quantized vs ~38MB fp32. Script takes ~30s to run once.

### 2. `offscreen/offscreen.js`
Set local model path before pipeline call. Remove `progress_callback` (no CDN download):
```js
import { pipeline, env } from '../vendor/transformers.min.js';

env.logging = false;
env.allowRemoteModels = false;                              // never hit CDN
env.localModelPath = chrome.runtime.getURL('vendor/models/'); // use bundled files

async function loadModel() {
  if (synthesizer) return;
  synthesizer = await pipeline('text-to-speech', 'Xenova/vits-ljspeech', { dtype: 'q8' });
}
```
- Remove `onProgress` param from `loadModel()`
- Remove `progress_callback` from pipeline call
- Keep `loadModel` throwing on error (content.js handles `kokoro_error`)

Update `kokoro_load` handler — no progress messages, just `kokoro_ready` or `kokoro_error`:
```js
if (msg.action === 'kokoro_load') {
  pendingTabId = msg.tabId;
  loadModel()
    .then(() => send({ action: 'kokoro_ready', tabId: pendingTabId }))
    .catch(err => send({ action: 'kokoro_error', error: err.message, tabId: pendingTabId }));
  return;
}
```

### 3. `content/content.js`
- Remove `kokoro_progress` message handler entirely (no more download progress)
- Remove `updateDownloadBar()` / `setStatus()` download-related calls
- Replace download progress bar `<div>` in settings HTML with a simple spinner/text:
  - Idle (model not loaded): show "Loading..." text when engine first selected
  - `kokoro_ready`: show "AI voice ready" / enable play
  - `kokoro_error`: show error message, revert toggle to Classic
- `setKokoroUIState` simplified to just: `'loading'` | `'ready'` | `'error'`
- Remove `#vox-dl-bar-wrap`, `#vox-dl-bar-track`, `#vox-dl-bar-fill`, `#vox-dl-pct` elements

### 4. `content/content.css`
- Remove `.vox-dl-bar-*` styles (no longer needed)

### 5. `.gitignore`
Add `vendor/models/` — model files are large, not committed to git.

### 6. `README.md`
Update install step to mention model download: "Run `zsh tools/fetch-deps.sh` once (~30s, downloads ~9MB AI voice model)"
Update privacy policy: "model files bundled locally, no runtime CDN fetch"

---

## Critical Files
- `tools/fetch-deps.sh` — add model file downloads
- `offscreen/offscreen.js` — local path + remove progress callback
- `content/content.js` — remove download progress UI/logic
- `content/content.css` — remove dl-bar CSS
- `.gitignore` — exclude vendor/models/
- `README.md` — update install instructions

---

## Why This Works
- `env.localModelPath = chrome.runtime.getURL('vendor/models/')` tells transformers.js to fetch from `chrome-extension://{id}/vendor/models/` instead of HuggingFace CDN
- Extension pages (offscreen docs) can fetch any `chrome-extension://` URL directly — no permissions needed beyond what the extension already has
- `env.allowRemoteModels = false` ensures no fallback CDN attempt
- `dtype: 'q8'` loads `onnx/model_quantized.onnx` (~9MB vs 38MB)
- User runs `fetch-deps.sh` once after cloning — no npm, no Node, just curl

---

## Verification
1. Run `zsh tools/fetch-deps.sh` (should now download model files too, ~30s)
2. Verify `vendor/models/Xenova/vits-ljspeech/onnx/model_quantized.onnx` exists
3. Reload extension in Chrome
4. Open any article, switch to AI Neural in settings
5. Should show brief "Loading..." (WASM init, ~2-3s), then "AI voice ready"
6. Press play — speech should start within a few seconds
7. Classic engine still works (speechSynthesis unchanged)
