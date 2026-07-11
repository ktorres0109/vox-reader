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
✓ Keyboard shortcuts — Alt+P play, Alt+E export, fully customizable (chrome://extensions/shortcuts)

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

(GitHub Pages deploys from `docs/` via `.github/workflows/pages.yml`.)

**One-time setup (required):**
1. Repo **Settings → Pages → Build and deployment → Source:** **Deploy from a branch**
2. Branch: **`gh-pages`** · Folder: **`/ (root)`**
3. Repo **Settings → Actions → General → Workflow permissions:** **Read and write**
4. Re-run **Deploy privacy page** (Actions → workflow → Run workflow) if needed

After a green deploy, verify: `https://ktorres0109.github.io/vox-reader/privacy.html`

Fallback: `https://github.com/ktorres0109/vox-reader/blob/main/PRIVACY.md`

## Suggested screenshots (1280×800 or 640×400)

Captured via `npm run capture:store`:

1. `01-player-article.png` — floating player on article
2. `02-settings-export.png` — export scope / format / bitrate
3. `03-popup.png` — extension popup
4. `04-iframe-selection.png` — Alt+R selection inside iframe
5. `05-chat-reply-scope.png` — chat reply scope controls
6. `06-immersive-reader.png` — immersive reader overlay

## Checklist before submit

- [ ] Run `npm run check:store` (icons, docs, version sync)
- [ ] Run `npm test` (includes e2e smoke count guard)
- [ ] Run `npm run release:store` → upload `dist/vox-reader.zip` (check + fetch-deps + strict pack)
- [ ] Run `npm run capture:store` → upload screenshots from `store-assets/`
- [ ] Upload icons 128×128 (already in `icons/`)
- [ ] Privacy policy URL live
- [ ] Test on clean Chrome profile
