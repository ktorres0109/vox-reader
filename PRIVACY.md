# Vox Reader — Privacy Policy

**Last updated:** July 2026

Vox Reader is a Chrome extension that reads web pages aloud with word highlighting. Your privacy is a core design goal: **reading and speech synthesis happen on your device**.

## What we collect

**We do not collect, transmit, or sell your personal data.** Vox Reader does not run analytics, advertising, or usage tracking.

## What stays on your device

- Page text you choose to read (processed locally for highlighting and speech)
- Extension preferences (speed, voice, colors, shortcuts) — synced via **Chrome Sync** if you use a signed-in Chrome profile
- Kokoro AI model and voice files — downloaded once per device to extension storage (`chrome.storage.local`)

## Network use

Vox Reader may connect to the network only when you:

1. **Download the Kokoro model** (~86 MB, one-time) from Hugging Face
2. **Download voice assets** bundled with the Kokoro model
3. **Fetch optional dependencies** during developer setup (`npm run fetch-deps`)

No page content is sent to Vox Reader servers — there are no Vox Reader servers for reading or TTS.

## Optional KReader sync

If you enable **KReader sync** in Settings, the extension polls `http://127.0.0.1:8766` on your machine to mirror highlights from the local KReader macOS app. This traffic never leaves your computer and is **off by default**.

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Save preferences and model cache |
| `activeTab` / `scripting` | Read and highlight the current page |
| `offscreen` | Run on-device AI speech synthesis |
| `downloads` | Save exported MP3/WAV files |
| `contextMenus` | “Read selection” from the right-click menu |
| `<all_urls>` | Work on any site you open (chat apps, articles, etc.) |

## Third parties

- **Kokoro 82M** (ONNX) — open-source neural TTS; model files from Hugging Face
- **ONNX Runtime Web** — runs the model in your browser via WebAssembly

## Children

Vox Reader is not directed at children under 13.

## Changes

We may update this policy as the extension evolves. Material changes will be reflected in the repository and extension listing.

## Contact

Open an issue on the [GitHub repository](https://github.com/ktorres0109/vox-reader) for privacy questions.
