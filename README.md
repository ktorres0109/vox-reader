# Vox Reader

A free, private Chrome extension that reads any webpage aloud with word-by-word and sentence highlighting.

No account. No API key. No data sent anywhere. Runs entirely in your browser using the Web Speech API.

---

## Features

- Word-by-word highlighting synced to speech
- Sentence-level highlighting with background or underline style
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

---

## Install (Developer Mode)

1. Clone or download this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the repo folder
5. Pin the Vox Reader icon in your toolbar

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

Voice quality depends on your OS and installed voices:

- **macOS** — Samantha, Ava, Serena, Victoria (excellent quality)
- **Windows** — Zira, Aria (good)
- **Linux** — eSpeak (basic)

On macOS, go to **System Settings → Accessibility → Spoken Content** to download additional high-quality voices.

---

## Privacy

Everything runs locally. No network requests are made by this extension. Your text never leaves your browser.

---

## License

MIT
