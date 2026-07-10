#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/wav.test.mjs
node tools/export-range.test.mjs
node tools/mp3.test.mjs
node tools/sentences.test.mjs
node tools/extension-id.test.mjs
node tools/validate-extension.mjs
node tools/popup-smoke.mjs
echo "All tests passed."
