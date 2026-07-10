#!/usr/bin/env bash
# Vox Reader — download AI voice dependencies (run once, no npm required)
# Usage: bash tools/fetch-deps.sh  (or zsh tools/fetch-deps.sh)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENDOR="$SCRIPT_DIR/../vendor"
mkdir -p "$VENDOR"

KOKORO_JS_VER="1.2.0"
TRANS_VER="3.3.3"

echo "Downloading kokoro-js v${KOKORO_JS_VER} (browser bundle)..."
curl -#L "https://cdn.jsdelivr.net/npm/kokoro-js@${KOKORO_JS_VER}/dist/kokoro.web.js" \
  -o "$VENDOR/kokoro.web.js"

echo ""
echo "Done! Saved to vendor/kokoro.web.js"
echo "Size: $(du -h "$VENDOR/kokoro.web.js" | cut -f1)"

# ONNX Runtime WASM — kokoro.web.js resolves these relative to import.meta.url
WASM_BASE="https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANS_VER}/dist"

echo ""
echo "Downloading ORT WASM files (~22MB)..."
curl -#L "$WASM_BASE/ort-wasm-simd-threaded.jsep.mjs"  -o "$VENDOR/ort-wasm-simd-threaded.jsep.mjs"
curl -#L "$WASM_BASE/ort-wasm-simd-threaded.jsep.wasm" -o "$VENDOR/ort-wasm-simd-threaded.jsep.wasm"
curl -#L "$WASM_BASE/ort.bundle.min.mjs"               -o "$VENDOR/ort.bundle.min.mjs" 2>/dev/null || true

echo ""
echo "Done! WASM files saved to vendor/"
echo ""
echo "The Kokoro 82M model (~86MB) and voice files download automatically"
echo "the first time you enable AI Neural voice in the extension."
echo ""
echo "Load the extension in Chrome → Settings → AI Neural → voices include Bella."
