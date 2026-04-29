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
echo ""
echo "WASM + model files are fetched from CDN on first use and cached by the browser."
echo "No further setup needed — load the extension in Chrome and enable AI voice."
