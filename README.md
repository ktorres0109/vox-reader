# Vox Reader

**Read any webpage aloud — with Bella, a natural AI voice, running entirely in your browser.**

Vox Reader is a free Chrome extension that highlights words and sentences as it reads. No account, no API key, no cloud processing. Your text never leaves your device.

<p align="center">
  <strong>Default voice: Bella</strong> · Kokoro 82M neural TTS · ChatGPT / Claude / Gemini support
</p>

---

## Why Vox Reader?

| | Vox Reader | Typical cloud TTS |
|---|------------|-------------------|
| Privacy | 100% on-device | Text sent to servers |
| Cost | Free | Subscription / API fees |
| Offline | Works after one-time model download | Requires internet |
| Highlighting | Word + sentence sync | Rarely built-in |
| Chat threads | Reads full assistant conversations | N/A |
| Export | Download MP3 or WAV (Kokoro) | Rarely built-in |

---

## Features

- **Bella AI voice (default)** — Kokoro 82M neural TTS; American + British voices
- **MP3 + WAV export** — scope: all / selection / from here; MP3 bitrates 96–192 kbps
- **Word-by-word highlighting** synced to speech
- **Sentence highlighting** — background fill or underline, custom colors
- **Chat reply scope** — read all replies, latest only, or pick one reply (ChatGPT / Claude / Gemini)
- **Live chat sync** — re-anchors highlights while responses stream in
- **Code blocks** — reads `<pre>` / `<code>` content aloud
- **Classic system voices** — instant, no download (macOS / Windows / Linux)
- **Floating player** — draggable bar with scrubbable progress, skip ±15 words
- **Immersive reader** — distraction-free view; **Print** outputs clean reader text
- **Selection reading** — popup, context menu, or **Alt+R** (including cross-origin iframes with in-frame word + sentence highlighting)
- **Click-to-jump** — click any word while playing to seek
- **Speed control** — 0.5× to 3.0× (Kokoro + Classic)
- **Keyboard shortcuts** — fully customizable; **Alt+P** works before opening player
- **Settings sync** — preferences follow you via Chrome Sync
- **KReader sync** (optional) — highlight sync with local KReader mac app
- **Accessible** — ARIA labels, live regions, focus indicators

---

## Quick start

### 1. Install dependencies (one time)

```bash
bash tools/fetch-deps.sh
# or: npm run fetch-deps
```

Downloads `kokoro.web.js` and ONNX Runtime WASM into `vendor/` (~25 MB).

### 2. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this repo folder
4. Pin **Vox Reader** to your toolbar

> **Requires Chrome 116+** for offscreen AI voice synthesis.

### 3. First use — AI voice download

On first open, Vox Reader downloads the **Kokoro 82M model** (~86 MB) from HuggingFace once per device.

1. Extension icon → **Open Player on Page**
2. Wait for download progress to reach 100%
3. Press **▶ Play**

---

## Usage

| Action | How |
|--------|-----|
| Open player | Extension icon → **Open Player on Page** |
| Read selection | Popup **▶ Read Selected Text**, right-click menu, or **Alt+R** |
| Play page | **▶** in the floating player (or **Alt+P** — opens player if needed) |
| Pause / resume | **▶** again or **Alt+P** |
| Stop | **Alt+S** |
| Export audio | **Export** or **Alt+E** — MP3/WAV (Kokoro; works on classic if AI model is loaded) |
| Print | **Print** — reader view in immersive mode, full page otherwise |
| Immersive mode | **☰** |
| Settings | **⚙** |

Long chat threads (4+ messages) prompt before scrolling full history to load virtualized messages.

---

## Voices (Kokoro 82M)

| Voice | ID | Notes |
|-------|-----|-------|
| **Bella** | `af_bella` | **Default** — warm American female |
| Sarah | `af_sarah` | American female |
| Sky | `af_sky` | American female |
| Nicole | `af_nicole` | Headphone-optimized female |
| Heart | `af_heart` | Highest-rated female |
| Adam | `am_adam` | American male |
| Michael | `am_michael` | American male |
| Emma | `bf_emma` | British female |
| Isabella | `bf_isabella` | British female |
| George | `bm_george` | British male |
| Lewis | `bm_lewis` | British male |

Classic system voices are available under **Settings → Classic** (no download).

---

## Development

```bash
git clone https://github.com/ktorres0109/vox-reader.git
cd vox-reader
npm install
npm run fetch-deps
npm test              # unit tests
npm run test:e2e      # Playwright smoke (requires Google Chrome)
```

CI runs `npm test` on every push/PR (GitHub Actions). E2E smoke runs in a separate job with Chrome + xvfb.

After changing extension code, **Reload** on `chrome://extensions` and refresh the target page.

### Project structure

```
vox-reader/
├── background/       # Service worker, downloads, offscreen routing
├── content/          # Player, highlighting, chat detection
├── offscreen/        # Kokoro synthesis + MP3/WAV encoders
├── popup/            # Toolbar popup
├── tools/
│   ├── fetch-deps.sh
│   └── run-tests.sh
└── vendor/           # Generated — run fetch-deps.sh
```

---

## Privacy

- All speech synthesis runs locally
- Settings sync via Chrome (`chrome.storage.sync`)
- Kokoro model weights download from HuggingFace on first use — no user text uploaded
- KReader sync (off by default) polls `127.0.0.1:8766` only when enabled
- No analytics or tracking

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| AI voice stuck downloading | Check internet; reload extension; try Classic engine |
| Play disabled | Wait for Kokoro download (progress bar) |
| Only last chat reply read | Update extension — reads all assistant messages |
| `kokoro.web.js` missing | `bash tools/fetch-deps.sh` |
| Export fails | Try shorter selection; check Downloads permission; first export downloads AI voice once |
| KReader highlights | Enable **Settings → KReader sync** |

---

## Privacy

Vox Reader processes text **on your device**. See [PRIVACY.md](PRIVACY.md) for the full policy (Chrome Web Store listing).

## Chrome Web Store

Listing copy and screenshot checklist: [STORE_LISTING.md](STORE_LISTING.md). Capture screenshots with `npm run capture:store`. Pack for upload with `npm run pack` → `dist/vox-reader.zip`.

Privacy page for store URL: [docs/privacy.html](docs/privacy.html) (GitHub Pages from `docs/`).

---

## License

MIT — see [LICENSE](LICENSE).
