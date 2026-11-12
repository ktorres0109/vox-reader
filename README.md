# Vox Reader

**Read any webpage aloud — with word-by-word highlighting. Free, private, runs on your computer.**

Highlight words and sentences as a natural voice reads the page. Works on articles, ChatGPT, Claude, Gemini, and more. No account required.

<p align="center">
  <strong>Default voice: Bella</strong> · Kokoro AI · ChatGPT / Claude / Gemini support
</p>

---

## Install and use (start here)

You do **not** need to publish anything to the Chrome Web Store to use Vox Reader on your own computer. You load it once as an **unpacked extension** — Chrome’s name for “run this extension from a folder on my machine.”

### What you need

| Requirement | Details |
|-------------|---------|
| **Browser** | [Brave](https://brave.com/) or [Google Chrome](https://www.google.com/chrome/) version **116 or newer** (any Chromium browser that allows unpacked extensions) |
| **This project folder** | The folder that contains `manifest.json` (clone with git, or download ZIP from GitHub and unzip) |
| **Internet (first time only)** | To download AI voice files (~25 MB setup, plus the model on first use: ~330 MB for the GPU backend or ~86 MB for CPU only) |

---

### Step 1 — Get the project folder

**Option A — Download ZIP (easiest if you don’t use git)**

1. Open https://github.com/ktorres0109/vox-reader  
2. Click the green **Code** button → **Download ZIP**  
3. Unzip it (e.g. to `Downloads/vox-reader-main`)  
4. Remember that folder path — you’ll select it in Chrome in Step 3  

**Option B — Clone with git**

```bash
git clone https://github.com/ktorres0109/vox-reader.git
cd vox-reader
```

---

### Step 2 — Download required AI files (one time)

The extension needs a few large files that are **not** stored in git. Run this **once** inside the project folder.

**Mac or Linux — open Terminal, then:**

```bash
cd path/to/vox-reader
bash tools/fetch-deps.sh
```

**Windows — open PowerShell or Command Prompt, then:**

```bash
cd path\to\vox-reader
npm run fetch-deps
```

*(If `npm` is not found, install [Node.js](https://nodejs.org/) first, then run `npm install` in the project folder, then `npm run fetch-deps`.)*

**Success looks like:** messages about downloading `kokoro.web.js`, WASM files, and `lame.min.js` into a new `vendor/` folder (~25 MB total).

> **Skip Step 2?** You can still use **Classic** system voices (Step 5 below) without running fetch-deps. AI voice and MP3 export need Step 2.

---

### Step 3 — Load the extension in Chrome

1. Open Chrome and go to: **`chrome://extensions`**  
   *(Paste that into the address bar and press Enter.)*

2. Turn **ON** the switch in the top-right: **Developer mode**

3. Click **Load unpacked**

4. In the file picker, select the **vox-reader folder** — the one that contains `manifest.json`  
   - ✅ Correct: `vox-reader/` (or `vox-reader-main/`)  
   - ❌ Wrong: a subfolder like `vox-reader/content/`  

5. You should see **Vox Reader** appear in the list with version **2.7.0** and ID **`dohedhjdgepbfiimpoabeefmkefjmfnb`** (the ID is fixed by the manifest `key`, so it is the same on every machine and after every reload)

   In Brave the page is **`brave://extensions`**; everything else is the same.

6. Click the **puzzle piece** icon in Chrome’s toolbar → **pin** Vox Reader so the icon stays visible

**If it fails:** make sure you picked the folder with `manifest.json` inside it, not a parent or child folder.

---

### Step 4 — Read your first page (2 minutes)

1. Open any normal webpage — e.g. a news article or Wikipedia  
2. Click the **Vox Reader** icon in the toolbar  
3. Click **Open Player on Page**  
4. A dark floating bar appears at the bottom of the page  
5. Click **▶ Play** (or press **Alt+P**)

You should hear speech and see words highlight as they’re read.

**Read only what you selected:** highlight text on the page → click the extension icon → **▶ Read Selected Text** (or press **Alt+R**).

---

### Step 5 — No waiting? Use Classic voice

The default **AI Neural (Bella)** voice downloads its model the first time you play or export (~330 MB on the GPU backend, ~86 MB with *CPU only*). To talk **immediately** with no download:

1. Open the player (**Alt+P** or extension icon → Open Player)  
2. Click **⚙ Settings**  
3. Under voice engine, click **Classic** (instead of AI Neural)  
4. Pick a voice from the dropdown  
5. Click **▶ Play**

Classic uses voices already installed on your Mac/Windows/Linux.

---

### Step 6 — Enable Bella AI voice (optional, one-time download)

1. In Settings, click **AI Neural**  
2. A progress bar appears — **Downloading Kokoro model** (~330 MB with GPU, ~86 MB CPU only)  
3. Wait until it reaches **100%** (needs internet; takes a few minutes on a typical connection)  
4. Press **▶ Play** — Bella reads with neural quality  

After this once, AI voice works offline.

---

## Daily cheat sheet

| I want to… | Do this |
|------------|---------|
| Open the player | Click extension icon → **Open Player on Page**, or **Alt+P** |
| Read the whole page | **▶ Play** |
| Read highlighted text only | Select text → **Alt+R** or popup **Read Selected Text** |
| Pause / resume | **▶** again, **Alt+P**, **Space** while reading, or the keyboard media key |
| Stop | **Alt+S** |
| Change speed | Speed pill (e.g. **1×**) → preset or slider; **[** / **]** (or **−** / **+**) while reading |
| Previous / next sentence | **⏮** / **⏭** on the bar, or **←** / **→** while reading |
| Pick up where you left off | Reopen the player on the same page → **Resume from 40%?** → **Resume** or **Start over** |
| Lost your place after scrolling | Click **↓ Back to reading** |
| Jump to a word | Click any highlighted word while playing |
| Read ChatGPT / Claude thread | Open the chat page → Play — use **Chat reading** in Settings for all replies vs latest only |
| Export MP3 or WAV | **⚙ Settings** → pick scope/format → **Export** (or **Alt+E**) |
| Distraction-free view | **☰** immersive reader |
| Change shortcuts | **⚙ Settings** → edit Alt+ keys → **Save** (also `chrome://extensions/shortcuts`) |

---

## After you change the code

If you edit files in this repo:

1. Go to **`chrome://extensions`**  
2. Find Vox Reader → click the **reload** ↻ button  
3. **Refresh** any tab where you’re testing  

---

## Troubleshooting

| Problem | What to do |
|---------|------------|
| **Load unpacked is greyed out** | Enable **Developer mode** on `chrome://extensions` |
| **“Manifest missing” or load fails** | Select the folder that contains `manifest.json`, not a subfolder |
| **Nothing happens when I click Play** | Open Settings → switch to **Classic** voice and try again |
| **Play button is disabled** | AI voice is still downloading — wait for the progress bar, or switch to Classic |
| **No sound at all** | Check system volume; try Classic voice; refresh the page after reloading the extension |
| **Extension icon missing** | Puzzle piece → pin Vox Reader |
| **Error about kokoro or vendor** | Run Step 2 again: `bash tools/fetch-deps.sh` or `npm run fetch-deps` |
| **Works on one site but not another** | Some pages block extensions — try a normal article site first |
| **Download stuck / want to cancel** | Wait until the bar says **Finishing AI voice setup…** — don’t cancel at 100%. If stuck, switch to **Classic** (e.g. Samantha) and try Play |
| **Says “Done” but never read anything** | Refresh the page, open the player again, and press Play — or use Classic voice until AI voice shows **ready** |
| **Still stuck** | `chrome://extensions` → Remove Vox Reader → load unpacked again from Step 3 |

---

## Why Vox Reader?

| | Vox Reader | Typical cloud TTS |
|---|------------|-------------------|
| Privacy | 100% on-device | Text sent to servers |
| Cost | Free | Subscription / API fees |
| Offline | Works after one-time model download | Requires internet |
| Highlighting | Word + sentence sync | Rarely built-in |
| Chat threads | Reads full assistant conversations | N/A |
| Export | Download MP3 or WAV | Rarely built-in |

---

## Features

- **Bella AI voice** — Kokoro 82M neural TTS on device (American + British voices), works **offline** after a one-time download
- **Gapless playback** — sentences are synthesized ahead and scheduled back to back on the audio clock, so there is no pause between them; pause/resume is exact
- **Floating player bar** (bottom of the page, in a shadow root so site CSS can't break it): previous/next sentence, play/pause, scrubber with **"N min left"**, speed menu, voice menu, settings popover
- **Resume reading** — your position is saved per page (URL without `#hash`, last 200 pages); reopening offers **Resume from N%?**
- **Clean speech** — skips citation markers (`[12]`, `[3][4]`, `[citation needed]`, `[a]`), footnote superscripts, and speaks only the domain of raw URLs; the page text and highlighting stay exactly as displayed
- **Highlight mode** — Word, Sentence (steadier, since word timing is estimated) or Off; fill or underline, custom colors
- **Themes** — Dark / Sepia / Light for the player and the immersive reader, plus reader font, size, width and line spacing
- **Keyboard while reading** — Space, ← / →, [ / ] (ignored while you type in a field)
- **Back to reading** pill when the current sentence is scrolled off screen (auto-follow pauses while you scroll)
- **Media keys / Now Playing** — play, pause, previous, next sentence
- **Classic voices** — instant system voices, no download
- **Chat reply scope** — all replies, latest only, or one reply (ChatGPT, Claude, Gemini)
- **MP3 + WAV export** — all / selection / from here
- **Selection reading** — popup, right-click, or **Alt+R** (works in iframes)
- **Focus Reader aware** — when the Focus Reader view is open, Vox reads and highlights its article
- **External API** — other extensions can ask Vox to read text (see below)

## Keyboard shortcuts

| Keys | Action | Where |
|------|--------|-------|
| **Alt+P** | Open player / play / pause | Anywhere (browser command, editable in `brave://extensions/shortcuts`) |
| **Alt+S** | Stop | Anywhere |
| **Alt+R** | Read selected text | Anywhere |
| **Alt+E** | Export audio | Anywhere |
| **Space** | Pause / resume | While Vox is reading, not while typing in a field |
| **← / →** | Previous / next sentence | While reading |
| **[ / ]** or **− / +** | Slower / faster | While reading |
| Media keys | Play/pause, previous/next sentence | While reading |

No clashes with Kelvin's other extensions: Focus Reader uses **Alt+Shift+R**, Page to Markdown **Alt+Shift+M**.

## Offline use and where the model lives

After the first successful load, Vox needs no network. All files come from the extension folder (`vendor/`) or from the browser's Cache Storage:

| What | Where |
|------|-------|
| Kokoro model: `onnx/model.onnx` (fp32, ~330 MB, GPU backend) and/or `onnx/model_quantized.onnx` (q8, ~88 MB, CPU backend), plus `config.json`, `tokenizer.json`, `tokenizer_config.json` | Cache Storage cache **`transformers-cache`** (transformers.js `env.useBrowserCache`) |
| Voice files (`voices/af_bella.bin`, ~0.5 MB each, one per voice you have used) | Cache Storage cache **`kokoro-voices`** |
| ONNX Runtime wasm + glue, kokoro-js bundle, MP3 encoder | `vendor/` in the extension folder (from `tools/fetch-deps.sh`) |

The caches belong to the extension's origin, **`chrome-extension://dohedhjdgepbfiimpoabeefmkefjmfnb`**, which the offscreen document (where Kokoro runs) shares. Entries are keyed by their Hugging Face URLs (`https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/...`). They are cleared by **removing the extension**, or by clearing site data for that origin. Reloading or updating the unpacked extension keeps them, since the ID never changes.

Offline was verified in Brave by loading the model once, then closing the offscreen document, turning the network off (`setOffline`) and blocking Hugging Face / jsdelivr. The model reloaded from cache and Vox spoke. To use a voice offline, play it once while online first.

Notes:
- `tools/fetch-deps.sh` patches `vendor/kokoro.web.js` so ONNX Runtime loads its wasm from `vendor/` instead of cdn.jsdelivr.net. The extension CSP blocks remote scripts, so without the patch the model cannot start, online or not.
- **GPU first, CPU fallback.** By default (voice menu → *Runs on: GPU if available*), Vox loads Kokoro on **WebGPU** (fp32 weights). Each sentence then synthesizes in 0.3 to 0.6 s on an M4 Pro, about 0.1x real time. If WebGPU is missing or fails, including when you are offline and only the CPU model is cached, Vox falls back to **wasm q8 on one CPU thread** automatically. That backend runs at about 1.3 to 2x real time, so there can be short pauses between sentences. *CPU only* skips the ~330 MB GPU download.
- The CPU backend is single-threaded. Multithreaded wasm needs cross-origin isolation; it measured about 0.7x real time in a quick test but was not verified stable, so it is not enabled.

## Known limits

- **CPU backend speed:** single-thread wasm (see above). Gapless scheduling removes the gap whenever the next sentence is ready in time. Pause can lag by up to the time it takes to synthesize the sentence in progress, because that work blocks the offscreen document. The GPU backend does not have this problem.
- **Long pauses:** if the browser closes the offscreen document while you are paused, Resume restarts the current sentence once the model has reloaded from cache.
- **Offscreen document closed by the browser:** if Brave closes the offscreen document mid-read, the tab is told (via a port) and continues from the current sentence after the model reloads from cache.
- **Media keys / Now Playing:** handlers and metadata are set in the offscreen document, and the audio goes through a hidden `<audio>` element so Chromium sees a media session. Physical media keys and macOS Now Playing were not verified by hand.

## External API (for other extensions)

Any installed extension can message Vox. There is no `externally_connectable` key, which means all extensions may connect and no web pages can.

```js
const VOX_ID = 'dohedhjdgepbfiimpoabeefmkefjmfnb';

// Is Vox installed?
chrome.runtime.sendMessage(VOX_ID, { action: 'vox_ping' }, (r) => {
  // r = { ok: true, version: '2.7.0' }   (chrome.runtime.lastError if not installed)
});

// Read text with the normal Vox player in a tab.
chrome.runtime.sendMessage(VOX_ID, {
  action: 'vox_read',
  text: 'The text to read…',     // required, up to 200k chars
  title: 'Article title',        // optional: shown in Now Playing
  tabId: 123,                    // optional: defaults to the sender's tab, then the active tab
}, (r) => {
  // r = { ok: true, tabId } or { ok: false, error }
});
```

It works from a content script (the sender's tab is used) or from a background script (pass `tabId`). If the text is on the page, Vox highlights it there. That includes inside Focus Reader's view, because Vox reads `#focus-reader-host`'s shadow-root article when it is open. If the text isn't on the page, Vox reads it without in-page highlighting.

---

## Voices (AI Neural)

| Voice | Notes |
|-------|-------|
| **Bella** | Default — warm American female |
| Sarah, Sky, Nicole, Heart | American female |
| Adam, Michael | American male |
| Emma, Isabella | British female |
| George, Lewis | British male |

---

## For developers

```bash
git clone https://github.com/ktorres0109/vox-reader.git
cd vox-reader
npm install
npm run fetch-deps
npm test              # unit tests
CHROME_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" npm run test:e2e
node tests/brave/features.mjs   # real-Brave feature/offline/focus-reader checks, evidence in $TMPDIR/vox-evidence
npm run release:store # store zip → dist/vox-reader.zip
```

After code changes: reload on `chrome://extensions`, then refresh the page.

Browser tests always run **muted** (`--mute-audio`) and load a temp copy of the extension whose first content script (`tests/brave/speech-mock.js`) replaces `speechSynthesis`. Muting silences Web Audio but not the OS speech engine.

The manifest `key` holds only the public key that fixes the extension ID. `npm run pack` removes it from the store zip, because the Chrome Web Store rejects uploads that contain one.

### Project structure

```
vox-reader/
├── manifest.json     ← Chrome looks for this file
├── background/       # Service worker
├── content/
│   ├── content.js        # reading, highlighting, player behaviour
│   ├── player.js         # player markup (shadow root)
│   ├── player-styles.js  # player CSS (constructable stylesheet)
│   └── lib/              # pure helpers with unit tests: text-clean, positions, playback-math
├── offscreen/        # Kokoro synthesis, gapless scheduler, media session
├── popup/            # Toolbar popup
├── tools/fetch-deps.sh
└── vendor/           # Created by fetch-deps (not in git)
```

---

## Privacy

All reading and speech run **on your device**. See [PRIVACY.md](PRIVACY.md) or the live policy: https://ktorres0109.github.io/vox-reader/privacy.html

---

## Chrome Web Store (optional)

To publish publicly: see [STORE_LISTING.md](STORE_LISTING.md). Build with `npm run release:store`.

---

## License

MIT — see [LICENSE](LICENSE).
