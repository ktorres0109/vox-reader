# Chrome Web Store listing — Vox Reader

Copy-ready text for publishing. Screenshots: run `node tools/capture-store-assets.mjs` (requires Chrome).

## Listing

| Field | Text |
|-------|------|
| **Name** | Vox Reader |
| **Short description** (132 chars max) | Read any page aloud with word highlighting. Bella AI voice, on-device, free. ChatGPT, Claude, Gemini, export MP3. |
| **Category** | Productivity |
| **Language** | English |

## Detailed description

```
Read any webpage aloud — with natural AI voice and word-by-word highlighting.

Vox Reader is a free Chrome extension. No account, no API key, no cloud. Your text stays on your device.

✓ Bella AI voice (Kokoro 82M neural TTS) — warm, natural, on-device
✓ American & British voices
✓ Word + sentence highlighting synced to speech
✓ Chat-aware — reads ChatGPT, Claude, Gemini threads (all replies or latest only)
✓ Export MP3 or WAV narration
✓ Classic system voices — instant, no download
✓ Floating player — speed 0.5×–3×, skip ±15 words, click-to-jump
✓ Immersive reader + clean print view
✓ Read selection — popup, right-click, Alt+R (works in iframes)
✓ Keyboard shortcuts — Alt+P play, Alt+E export, fully customizable

PRIVACY FIRST
All reading and AI speech synthesis run locally in your browser. See PRIVACY.md in the repo.

FIRST USE
The AI voice downloads once (~86 MB). After that, works offline.

REQUIREMENTS
Chrome 116+ recommended for AI voice export and synthesis.

Open-source: https://github.com/ktorres0109/vox-reader
```

## Single purpose

Provide text-to-speech with visual highlighting for web page content the user chooses to read.

## Permission justification (for review)

| Permission | Justification |
|------------|----------------|
| `storage` | Save voice, speed, colors, shortcuts |
| `activeTab` / `scripting` | Highlight and read the active page |
| `offscreen` | On-device Kokoro TTS synthesis |
| `downloads` | Save exported MP3/WAV files |
| `contextMenus` | “Read selection with Vox Reader” |
| `<all_urls>` | User-initiated reading on any site they visit |

## Privacy policy URL

`https://ktorres0109.github.io/vox-reader/privacy.html`

(GitHub Pages deploys from `docs/` on push to `main` — enable Pages in repo Settings → Pages → Source: GitHub Actions if not already on.)

Fallback: `https://github.com/ktorres0109/vox-reader/blob/main/PRIVACY.md`

## Suggested screenshots (1280×800 or 640×400)

1. Floating player on article with word highlight
2. Settings — Bella voice + export MP3
3. ChatGPT thread with “Chat reading → Latest only”
4. Popup — Open player + shortcuts
5. Export scope — Selection / MP3 bitrate

## Checklist before submit

- [ ] Run `npm run fetch-deps` before packing
- [ ] Bump `manifest.json` version
- [ ] Run `npm run pack` → upload `dist/vox-reader.zip`
- [ ] Upload icons 128×128 (already in `icons/`)
- [ ] Privacy policy URL live
- [ ] Test on clean Chrome profile
