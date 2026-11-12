// Vox Reader — player CSS, applied inside the player's shadow root (site CSS can't reach it).
// Kept as a JS string so it can be adopted as a constructable stylesheet, which page
// CSP (style-src) does not block, and needs no web_accessible_resources entry.
globalThis.VOX_PLAYER_CSS = String.raw`
:host {
  all: initial;
  position: fixed !important;
  z-index: 2147483647 !important;
  left: 0; right: 0; bottom: 16px;
  display: flex; justify-content: center;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif;
  font-size: 13px; line-height: 1.3;
  --bg: #141414; --bg2: #1c1c1c; --bg3: #252525; --line: #2c2c2c;
  --fg: #ededed; --fg2: #a3a3a3; --fg3: #6b6b6b;
  --accent: #f59e0b; --accent-fg: #111; --shadow: 0 12px 40px rgba(0,0,0,0.55);
  color-scheme: dark;
}
:host(.vox-hidden) { display: none !important; }
:host([data-theme="sepia"]) {
  --bg: #f4ecd8; --bg2: #ebe0c6; --bg3: #dfd1b2; --line: #d3c4a3;
  --fg: #3b2f1e; --fg2: #6b5a40; --fg3: #8f7d60;
  --accent: #b45309; --accent-fg: #fff8eb; --shadow: 0 10px 30px rgba(60,40,10,0.25);
  color-scheme: light;
}
:host([data-theme="light"]) {
  --bg: #ffffff; --bg2: #f3f4f6; --bg3: #e5e7eb; --line: #e2e2e2;
  --fg: #111827; --fg2: #4b5563; --fg3: #6b7280;
  --accent: #d97706; --accent-fg: #fff; --shadow: 0 10px 30px rgba(0,0,0,0.18);
  color-scheme: light;
}
* { box-sizing: border-box; }
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
.vs-hidden, [hidden] { display: none !important; }

#vox-shell {
  pointer-events: auto;
  position: relative;
  width: min(760px, calc(100vw - 24px));
}

/* ── Bar ── */
#vox-bar {
  display: flex; align-items: center; gap: 6px;
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--line); border-radius: 18px;
  padding: 8px 10px; box-shadow: var(--shadow);
}
.vox-bar-btn {
  background: none; border: none; color: var(--fg2);
  min-width: 32px; height: 32px; padding: 0 7px; border-radius: 9px;
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  font-size: 13px; white-space: nowrap; flex-shrink: 0;
}
.vox-bar-btn:hover { color: var(--fg); background: var(--bg3); }
.vox-bar-btn.active, .vox-bar-btn[aria-expanded="true"] { color: var(--accent); background: var(--bg2); }
.vox-bar-btn svg { width: 16px; height: 16px; fill: currentColor; }
#vox-playpause-bar {
  width: 40px; height: 40px; min-width: 40px; border-radius: 50%;
  background: var(--accent); color: var(--accent-fg); border: none;
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  font-size: 15px;
}
#vox-playpause-bar:hover { filter: brightness(1.08); }
#vox-playpause-bar:disabled { opacity: 0.45; cursor: not-allowed; }
#vox-playpause-bar svg { width: 18px; height: 18px; fill: currentColor; }

#vox-progress-wrap { flex: 1; min-width: 90px; display: flex; flex-direction: column; gap: 3px; padding: 0 6px; }
#vox-progress {
  -webkit-appearance: none; appearance: none; width: 100%; height: 4px; margin: 6px 0 0;
  border-radius: 2px; outline: none; cursor: pointer;
  background: linear-gradient(to right, var(--accent) 0%, var(--accent) var(--pct, 0%), var(--bg3) var(--pct, 0%));
}
#vox-progress::-webkit-slider-thumb {
  -webkit-appearance: none; width: 13px; height: 13px; border-radius: 50%;
  background: var(--accent); border: 2px solid var(--bg); cursor: pointer;
}
.vox-meta { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--fg3); white-space: nowrap; }
#vox-status { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
#vox-status.playing { color: var(--accent); }
#vox-time-left { font-variant-numeric: tabular-nums; flex-shrink: 0; }

.vox-pill {
  background: var(--bg2); border: 1px solid var(--line); color: var(--fg2);
  border-radius: 999px; height: 30px; padding: 0 10px; font-size: 12px;
  font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0;
  max-width: 120px; overflow: hidden; text-overflow: ellipsis;
}
.vox-pill:hover, .vox-pill[aria-expanded="true"] { color: var(--fg); border-color: var(--accent); }
.vox-div { width: 1px; height: 22px; background: var(--line); flex-shrink: 0; }

/* ── Popovers (open above the bar) ── */
.vox-pop {
  display: none; position: absolute; bottom: calc(100% + 8px);
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow);
  max-height: min(72vh, 560px); overflow-y: auto; padding: 12px 14px;
  scrollbar-width: thin;
}
.vox-pop.open { display: block; }
#vox-speed-menu { right: 120px; width: 230px; }
#vox-voice-menu { right: 60px; width: 290px; }
#vox-settings { right: 0; width: min(400px, calc(100vw - 24px)); padding: 0; }
.vox-pop-title { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--fg3); margin: 0 0 8px; }
.vox-speed-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
.vox-speed-opt {
  background: var(--bg2); border: 1px solid var(--line); color: var(--fg2);
  border-radius: 8px; padding: 6px 0; font-size: 12px; font-variant-numeric: tabular-nums;
}
.vox-speed-opt[aria-checked="true"] { border-color: var(--accent); color: var(--accent); }

#vox-settings-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px 9px; border-bottom: 1px solid var(--line);
  position: sticky; top: 0; background: var(--bg); z-index: 1;
}
.vox-settings-title { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--fg3); }
#vox-settings-close { background: none; border: none; color: var(--fg3); font-size: 14px; padding: 3px 6px; border-radius: 6px; }
#vox-settings-close:hover { color: var(--fg); background: var(--bg3); }
#vox-settings-body { padding: 10px 14px 14px; }

.vs { margin-bottom: 14px; }
.vs:last-child { margin-bottom: 0; }
.vs-label { display: block; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg3); margin-bottom: 6px; }
.vs-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.vs-row + .vs-row { margin-top: 8px; }
.vs-row > .vs-k { font-size: 12px; color: var(--fg2); min-width: 78px; }

.vs-speed-row { display: flex; align-items: center; gap: 10px; }
input[type=range].vs-range, .vs-speed-row input[type=range] {
  flex: 1; -webkit-appearance: none; appearance: none; height: 4px; border-radius: 2px;
  background: var(--bg3); outline: none; cursor: pointer;
}
input[type=range].vs-range::-webkit-slider-thumb, .vs-speed-row input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--accent); border: 2px solid var(--bg);
}
.vs-speed-dim { font-size: 10px; color: var(--fg3); }
.vs-speed-val { font-size: 12px; color: var(--accent); min-width: 38px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }

select, .vs-select {
  background: var(--bg2); border: 1px solid var(--line); color: var(--fg);
  border-radius: 9px; padding: 7px 9px; font-size: 12px; outline: none; max-width: 100%;
}
#vox-voice-select, #vox-kokoro-voice-select { width: 100%; }
select:disabled { opacity: 0.55; cursor: not-allowed; }

.vs-seg { display: inline-flex; background: var(--bg2); border: 1px solid var(--line); border-radius: 9px; padding: 2px; gap: 2px; }
.vs-seg button, .vs-engine-btn, .vs-hl-btn {
  background: none; border: 1px solid transparent; color: var(--fg2);
  border-radius: 7px; padding: 5px 10px; font-size: 12px;
}
.vs-seg button[aria-pressed="true"], .vs-engine-btn.active, .vs-hl-btn.active {
  background: var(--bg); border-color: var(--accent); color: var(--accent);
}
.vs-engine-row { display: flex; gap: 6px; margin-bottom: 8px; }
.vs-engine-btn { flex: 1; background: var(--bg2); border-color: var(--line); padding: 7px 8px; }

.vs-hex-mini {
  width: 76px; background: var(--bg2); border: 2px solid var(--line); color: var(--fg);
  border-radius: 7px; padding: 4px 6px; font-size: 11px; font-family: ui-monospace, monospace; outline: none;
}
.vs-toggle {
  position: relative; width: 34px; height: 20px; background: var(--bg3);
  border-radius: 999px; border: none; flex-shrink: 0; padding: 0;
}
.vs-toggle.on { background: var(--accent); }
.vs-toggle::after {
  content: ''; position: absolute; width: 14px; height: 14px; border-radius: 50%;
  background: #fff; top: 3px; left: 3px; transition: transform 0.2s;
}
.vs-toggle.on::after { transform: translateX(14px); }
.vs-sc-inline { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.vs-sc-lbl { font-size: 11px; color: var(--fg3); }
.vs-sc-pair { display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--fg2); }
.vs-sc-input {
  width: 28px; background: var(--bg2); border: 1px solid var(--line); color: var(--fg);
  border-radius: 6px; padding: 3px; text-align: center; font-size: 11px; font-family: ui-monospace, monospace; outline: none;
}
.vs-btn, .vs-sc-save, .vs-export-btn {
  background: var(--bg2); border: 1px solid var(--line); color: var(--fg2);
  border-radius: 8px; padding: 5px 10px; font-size: 12px; white-space: nowrap;
}
.vs-btn:hover, .vs-sc-save:hover, .vs-export-btn:hover { color: var(--fg); border-color: var(--accent); }
.vs-btn.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.vs-sc-save { margin-left: auto; }
.vs-export-format { padding: 5px 6px; font-size: 12px; }
.vs-export-format:disabled, .vs-export-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.vs-kokoro-info, .vs-note { font-size: 11px; color: var(--fg3); margin: 6px 0 0; line-height: 1.45; }
.vs-label-muted { font-size: 11px; color: var(--fg3); }

/* ── Banners above the bar (install progress, resume prompt) ── */
.vox-banner {
  background: var(--bg); color: var(--fg); border: 1px solid var(--line);
  border-radius: 14px; box-shadow: var(--shadow); padding: 10px 14px; margin-bottom: 8px;
  font-size: 12px;
}
.vox-banner p { margin: 0 0 6px; }
#vox-kokoro-install progress { width: 100%; height: 6px; accent-color: var(--accent); }
.vs-install-cancel { margin-top: 6px; width: 100%; background: transparent; border: 1px solid var(--line); color: var(--fg2); border-radius: 8px; padding: 6px; font-size: 12px; }
#vox-resume { display: flex; align-items: center; gap: 8px; }
#vox-resume-text { flex: 1; }

#vox-back-to-reading {
  position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(100% + 10px);
  background: var(--accent); color: var(--accent-fg); border: none; border-radius: 999px;
  padding: 7px 14px; font-size: 12px; font-weight: 600; box-shadow: var(--shadow);
}

button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

@media (max-width: 560px) {
  #vox-bar { flex-wrap: wrap; }
  #vox-progress-wrap { order: 10; flex-basis: 100%; }
  .vox-div { display: none; }
  #vox-speed-menu, #vox-voice-menu { right: 0; }
}
`;
