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
| **Browser** | [Google Chrome](https://www.google.com/chrome/) version **116 or newer** |
| **This project folder** | The folder that contains `manifest.json` (clone with git, or download ZIP from GitHub and unzip) |
| **Internet (first time only)** | To download AI voice files (~25 MB setup + ~86 MB when you first use Bella) |

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

5. You should see **Vox Reader** appear in the list with version **2.6.2**

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

The default **AI Neural (Bella)** voice downloads ~86 MB the first time you play or export. To talk **immediately** with no download:

1. Open the player (**Alt+P** or extension icon → Open Player)  
2. Click **⚙ Settings**  
3. Under voice engine, click **Classic** (instead of AI Neural)  
4. Pick a voice from the dropdown  
5. Click **▶ Play**

Classic uses voices already installed on your Mac/Windows/Linux.

---

### Step 6 — Enable Bella AI voice (optional, one-time download)

1. In Settings, click **AI Neural**  
2. A progress bar appears — **Downloading Kokoro model (~86MB)**  
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
| Pause / resume | **▶** again or **Alt+P** |
| Stop | **Alt+S** |
| Change speed | Click the speed pill (e.g. **1.0×**) or use the slider in Settings |
| Skip forward / back | **+15** / **−15** buttons on the player bar |
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

- **Bella AI voice** — Kokoro neural TTS; American + British voices  
- **Classic voices** — instant, no download  
- **Word + sentence highlighting** synced to speech  
- **Chat reply scope** — all replies, latest only, or one reply  
- **MP3 + WAV export** — all / selection / from here  
- **Selection reading** — popup, right-click, or **Alt+R** (works in iframes)  
- **Floating player** — speed, skip, scrub, click-to-jump  
- **Immersive reader** + print view  
- **Keyboard shortcuts** — customizable  

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
npm run test:e2e      # Playwright (requires Chrome)
npm run release:store # store zip → dist/vox-reader.zip
```

After code changes: reload on `chrome://extensions`, then refresh the page.

### Project structure

```
vox-reader/
├── manifest.json     ← Chrome looks for this file
├── background/       # Service worker
├── content/          # Player + highlighting
├── offscreen/        # AI speech synthesis
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
