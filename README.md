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

---

## Features

- **Bella AI voice (default)** — Kokoro 82M neural TTS; switch to Sarah, Sky, Nicole, Adam, Michael, and more
- **Word-by-word highlighting** synced to speech
- **Sentence highlighting** — background fill or underline, custom colors
- **Chat-aware reading** — ChatGPT, Claude, Gemini, Perplexity; reads all assistant replies in order
- **Code blocks** — reads `<pre>` / `<code>` content aloud
- **Classic system voices** — instant, no download (macOS / Windows / Linux)
- **Floating player** — draggable bar with scrubbable progress, skip ±15 words
- **Immersive reader** — distraction-free full-screen view
- **Selection reading** — highlight text → Alt+R
- **Click-to-jump** — click any word while playing to seek
- **Speed control** — 0.5× to 3.0×
- **Keyboard shortcuts** — fully customizable
- **Settings sync** — preferences follow you via Chrome Sync
- **Accessible** — ARIA labels, live regions, focus indicators

---

## Quick start

### 1. Install dependencies (one time)

The extension bundles the Kokoro runtime library locally. Run this once after cloning:

```bash
bash tools/fetch-deps.sh
```

This downloads `kokoro.web.js` and ONNX Runtime WASM files into `vendor/` (~25 MB).

### 2. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this repo folder
4. Pin **Vox Reader** to your toolbar

> **Requires Chrome 116+** for offscreen AI voice synthesis.

### 3. First use — AI voice download

On first open, Vox Reader downloads the **Kokoro 82M model** (~86 MB) from HuggingFace. This happens once per device and is cached for offline use.

1. Click the extension icon → **Open Player on Page**
2. Wait for the download progress bar to reach 100%
3. Press **▶ Play** — Bella reads the page

You can change voice anytime in **⚙ Settings → AI Neural**.

---

## Usage

| Action | How |
|--------|-----|
| Open player | Extension icon → **Open Player on Page** |
| Read selection | Highlight text → **▶ Read Selected Text** in popup, right-click → **Read selection with Vox Reader**, or **Alt+R** |
| Play page | Press **▶** in the floating player |
| Pause / resume | **▶** again or **Alt+P** |
| Stop | **Alt+S** |
| Jump to word | Click a highlighted word while playing |
| Scrub | Drag the progress bar |
| Skip | **↺ −15** / **↻ +15** word buttons |
| Immersive mode | **☰** — clean reading view |
| Settings | **⚙** — speed, voice, highlights, shortcuts |

## Read selected text

Three ways to read only what you've highlighted:

1. **Extension popup** — select text on the page → click the Vox icon → **▶ Read Selected Text**
2. **Right-click** — select text → **Read selection with Vox Reader**
3. **Keyboard** — select text → **Alt+R** (with the player open on the page)

Selection reading wraps and highlights only the chosen passage — it won't continue into the rest of the page.

---

### AI Neural (Kokoro 82M) — default

| Voice | ID | Notes |
|-------|-----|-------|
| **Bella** | `af_bella` | **Default** — warm, natural female |
| Sarah | `af_sarah` | Clear female |
| Sky | `af_sky` | Light female |
| Nicole | `af_nicole` | Headphone-optimized female |
| Heart | `af_heart` | Highest-rated female |
| Adam | `am_adam` | Male |
| Michael | `am_michael` | Male |

Speed applies to both AI Neural and Classic engines.

### Classic system voices

Instant playback, no download. Quality depends on your OS:

- **macOS** — Samantha, Ava, Serena (excellent with premium voices installed)
- **Windows** — Zira, Aria
- **Linux** — eSpeak (basic)

Install premium voices: **System Settings → Accessibility → Spoken Content** (macOS).

Switch engines in **⚙ Settings → Classic / AI Neural**.

---

## Works great on

- Articles, blogs, documentation, Wikipedia
- **ChatGPT** — full assistant conversation threads
- **Claude** — all responses in a chat
- **Gemini** — including shadow-DOM message content
- Perplexity, Notion, SPAs (React, Next.js)

For long chat histories, Vox scrolls the conversation pane to load virtualized messages before reading.

---

## Keyboard shortcuts

Defaults (customizable in Settings):

| Shortcut | Action |
|----------|--------|
| `Alt+P` | Play / Pause |
| `Alt+S` | Stop |
| `Alt+R` | Read selected text |

---

## Project structure

```
vox-reader/
├── background/       # Service worker (message routing, offscreen lifecycle)
├── content/          # In-page player, highlighting, chat detection
├── offscreen/        # Kokoro TTS synthesis (isolated from page)
├── popup/            # Toolbar popup
├── tools/
│   └── fetch-deps.sh # Download kokoro-js + WASM (run once)
└── vendor/           # Generated — not committed (see .gitignore)
```

---

## Privacy

**This extension does not collect, transmit, or store any personal data.**

- All speech synthesis runs locally in your browser
- Settings sync via your Chrome account (`chrome.storage.sync`) — Google's standard sync
- **AI Neural only:** Kokoro model weights (~86 MB) download from HuggingFace's public CDN on first use. No user text is ever uploaded — only model files
- No analytics, no tracking, no accounts

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| AI voice stuck on "Downloading…" | Check internet; reload extension; toggle Classic → AI Neural in Settings |
| Play button disabled | Wait for Kokoro download to finish (progress bar) |
| Only reads last chat reply | Update to latest version — reads all assistant messages |
| `kokoro.web.js` missing | Run `bash tools/fetch-deps.sh` and reload extension |
| No sound | Check system volume; try Classic voice to isolate issue |

---

## Development

```bash
git clone https://github.com/ktorres0109/vox-reader.git
cd vox-reader
bash tools/fetch-deps.sh
# Load unpacked in chrome://extensions
```

After changing `content/` or `offscreen/` code, click **Reload** on `chrome://extensions` and refresh the target page.

---

## License

MIT — see [LICENSE](LICENSE).
