# Vox Reader

A free, private Chrome extension that reads any webpage aloud with word-by-word and sentence highlighting.

No account. No API key. Your text never leaves your browser.

---

## Features

- Word-by-word highlighting synced to speech
- Sentence-level highlighting with background or underline style
- **AI Neural Voice** — Kokoro 82M model, downloads once (~80MB), works offline after
- Classic system voices — instant, no download
- Draggable floating player bar
- Adjustable speed (0.5× – 3.0×) via slider or click-to-cycle pill
- Voice selector (filters for English voices, prefers high-quality ones)
- Scrubable progress bar with click-to-jump
- Read selected text or jump to any word by clicking it
- Immersive reader mode — strips page chrome, clean serif view
- Customizable highlight colors (word + sentence, hex input)
- Customizable keyboard shortcuts
- Saves all preferences via Chrome sync storage
- Works on any page including SPAs (React, Next.js, Notion, Perplexity)
- WCAG 2.1 AA accessible (ARIA labels, focus indicators, live regions)

---

## Install (Developer Mode)

1. Clone or download this repo
2. Run `zsh tools/fetch-deps.sh` once to download the AI voice library
3. Open Chrome → `chrome://extensions`
4. Enable **Developer mode** (top-right toggle)
5. Click **Load unpacked** → select the repo folder
6. Pin the Vox Reader icon in your toolbar

> **Requires Chrome 116+** (for AI Neural Voice offscreen synthesis)

---

## Usage

| Action | How |
|--------|-----|
| Open player | Click extension icon → **Open Player on Page** |
| Play entire page | Press ▶ in the player |
| Read selection | Highlight text → Alt+R (or ▶ while text is selected) |
| Jump to word | Click any word while reading |
| Scrub position | Drag the progress bar |
| Skip | ↺ −15 / ↻ +15 word buttons |
| Immersive mode | ☰ button — clean full-screen reading view |
| Settings | ⚙ button — speed, voice, highlights, shortcuts |

---

## Keyboard Shortcuts

Defaults — all customizable in Settings:

| Shortcut | Action |
|----------|--------|
| `Alt+P` | Play / Pause |
| `Alt+S` | Stop |
| `Alt+R` | Read selected text |

---

## Voice Quality

**AI Neural Voice (Kokoro)** — Enable in Settings → Voice Engine → AI Neural. Downloads the Kokoro 82M model (~80MB) on first use from HuggingFace's public CDN, then works fully offline. Available voices: Bella, Sarah, Sky, Nicole (Female), Adam, Michael (Male).

**Classic System Voices** — Instant playback, no download. Quality depends on OS:

- **macOS** — Samantha, Ava, Serena, Victoria (excellent)
- **Windows** — Zira, Aria (good)
- **Linux** — eSpeak (basic)

On macOS: **System Settings → Accessibility → Spoken Content** to install premium voices.

---

## Privacy Policy

**This extension does not collect, transmit, or store any personal data.**

- All speech synthesis happens locally in your browser
- Settings sync via your own Chrome sync account (`chrome.storage.sync`) — controlled by Google's standard sync infrastructure
- **AI Neural Voice only:** The Kokoro model weights (~80MB) are fetched from HuggingFace's public CDN (`huggingface.co`) on first enable. No user text is sent — only the model files are downloaded. Your text is never uploaded anywhere.
- No analytics, no tracking, no external servers operated by this extension
- No account required

---

## License

MIT
