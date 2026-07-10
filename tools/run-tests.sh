#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/wav.test.mjs
node tools/sentences.test.mjs
node tools/validate-extension.mjs
node tools/popup-smoke.mjs
echo "All tests passed."
