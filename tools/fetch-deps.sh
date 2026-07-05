#!/bin/zsh
# Vox Reader — download AI voice dependencies (run once, no npm required)
# Usage: zsh tools/fetch-deps.sh

set -e
SCRIPT_DIR="${0:A:h}"
VENDOR="$SCRIPT_DIR/../vendor"
mkdir -p "$VENDOR"

# Pin transformers.js version for reproducibility
TRANS_VER="3.3.3"

echo "Downloading @huggingface/transformers v${TRANS_VER}..."
curl -#L "https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANS_VER}/dist/transformers.min.js" \
  -o "$VENDOR/transformers.min.js"

echo ""
echo "Done! Saved to vendor/transformers.min.js"
echo "Size: $(du -h "$VENDOR/transformers.min.js" | cut -f1)"

# Download mms-tts-eng model files (~38MB quantized, run once)
MODEL_DIR="$VENDOR/models/Xenova/mms-tts-eng"
mkdir -p "$MODEL_DIR/onnx"
BASE="https://huggingface.co/Xenova/mms-tts-eng/resolve/main"

echo ""
echo "Downloading Xenova/mms-tts-eng model files (~38MB)..."
curl -#L "$BASE/config.json"               -o "$MODEL_DIR/config.json"
curl -#L "$BASE/tokenizer.json"            -o "$MODEL_DIR/tokenizer.json"
curl -#L "$BASE/tokenizer_config.json"     -o "$MODEL_DIR/tokenizer_config.json"
curl -#L "$BASE/vocab.json"                -o "$MODEL_DIR/vocab.json"
curl -#L "$BASE/onnx/model_quantized.onnx" -o "$MODEL_DIR/onnx/model_quantized.onnx"

echo ""
echo "Done! Model files saved to vendor/models/"
echo "ONNX size: $(du -h "$MODEL_DIR/onnx/model_quantized.onnx" | cut -f1)"
# Download ONNX Runtime WASM files — must live in vendor/ (same dir as transformers.min.js)
# so webpack's public-path-relative URL resolution finds them at runtime.
WASM_BASE="https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANS_VER}/dist"

echo ""
echo "Downloading ORT WASM files (~22MB)..."
curl -#L "$WASM_BASE/ort-wasm-simd-threaded.jsep.mjs"  -o "$VENDOR/ort-wasm-simd-threaded.jsep.mjs"
curl -#L "$WASM_BASE/ort-wasm-simd-threaded.jsep.wasm" -o "$VENDOR/ort-wasm-simd-threaded.jsep.wasm"

echo ""
echo "Done! WASM files saved to vendor/"
echo ""
echo "Load the extension in Chrome and enable AI Neural voice — no CDN fetch needed."
