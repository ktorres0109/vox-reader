// Real-Brave test harness for Vox Reader (muted, speech mocked).
//
// Usage: node tests/brave/<scenario>.mjs
//   BRAVE_PATH  override the browser binary (default: Brave on macOS)
//   VOX_PROFILE reuse a profile dir (default: $TMPDIR/vox-brave-profile) so the
//               ~86 MB Kokoro model is downloaded only once across runs.
//
// Safety: the browser always gets --mute-audio, and the extension is loaded from
// a temp copy whose manifest prepends tests/brave/speech-mock.js so the classic
// speechSynthesis path can never reach macOS TTS. Every page is checked for the
// mock marker before a test touches it.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = os.tmpdir();
export const evidenceDir = path.join(TMP, 'vox-evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const BRAVE = process.env.BRAVE_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const FOCUS_READER_SRC = process.env.FOCUS_READER_PATH || path.resolve(repoRoot, '..', '..', 'extensions', 'focus-reader');

const SKIP = new Set(['.git', 'node_modules', 'dist', 'tests', 'tools', 'docs', 'store-assets', 'test-results', 'playwright-report']);

function copyDir(src, dst, skip = new Set()) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(ent.name) || ent.name === '.DS_Store') continue;
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** Copy Vox to a temp dir and prepend the speech mock to every content script entry. */
export function prepareVoxCopy() {
  const dst = path.join(TMP, 'vox-brave-ext', 'vox');
  copyDir(repoRoot, dst, SKIP);
  fs.copyFileSync(path.join(repoRoot, 'tests/brave/speech-mock.js'), path.join(dst, '__speech_mock.js'));
  const mf = JSON.parse(fs.readFileSync(path.join(dst, 'manifest.json'), 'utf8'));
  for (const cs of mf.content_scripts || []) cs.js = ['__speech_mock.js', ...cs.js];
  // A unique 4th version component per run: with an unchanged version, Brave
  // keeps running the previously registered (stale) service worker script
  // from the persistent profile instead of the copied one.
  mf.version = `${mf.version.split('.').slice(0, 3).join('.')}.${Math.floor(Date.now() / 1000) % 60000}`;
  fs.writeFileSync(path.join(dst, 'manifest.json'), JSON.stringify(mf, null, 2));
  // Programmatic injection (popup/SW fallback) must also carry the mock.
  for (const f of ['background/service_worker.js', 'popup/popup.js']) {
    const p = path.join(dst, f);
    const src = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, src.replace(/const CONTENT_FILES = \[/, "const CONTENT_FILES = ['__speech_mock.js', "));
  }
  return dst;
}

/** Copy focus-reader (never edited in place) and make it inject a speech mock too. */
export function prepareFocusReaderCopy() {
  const dst = path.join(TMP, 'vox-brave-ext', 'focus-reader');
  copyDir(FOCUS_READER_SRC, dst);
  const mock = fs.readFileSync(path.join(repoRoot, 'tests/brave/speech-mock.js'), 'utf8')
    .replace('voxSpeechMock', 'focusSpeechMock');
  fs.writeFileSync(path.join(dst, '__speech_mock.js'), mock);
  const bg = path.join(dst, 'background.js');
  fs.writeFileSync(bg, fs.readFileSync(bg, 'utf8').replace('files: ["Readability.js"', 'files: ["__speech_mock.js", "Readability.js"'));
  // Test copy only: host access so the harness can open the reader without a toolbar click.
  const mfPath = path.join(dst, 'manifest.json');
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  mf.host_permissions = ['<all_urls>'];
  fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
  return dst;
}

/** Serve tests/fixtures with python's http.server on 127.0.0.1. */
export async function startFixtureServer() {
  const dir = fs.mkdtempSync(path.join(TMP, 'vox-fixtures-'));
  for (const f of fs.readdirSync(path.join(repoRoot, 'tests/fixtures'))) {
    fs.copyFileSync(path.join(repoRoot, 'tests/fixtures', f), path.join(dir, f));
  }
  const port = 18000 + Math.floor(Math.random() * 2000);
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(base + '/article.html'); if (r.ok) break; } catch (_) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base, stop: () => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

export async function launch({ withFocusReader = false, freshProfile = false } = {}) {
  const vox = prepareVoxCopy();
  const exts = [vox];
  if (withFocusReader) exts.push(prepareFocusReaderCopy());
  const profile = freshProfile
    ? fs.mkdtempSync(path.join(TMP, 'vox-test-'))
    : (process.env.VOX_PROFILE || path.join(TMP, 'vox-brave-profile'));
  fs.mkdirSync(profile, { recursive: true });
  // Brave keeps serving a previously registered extension service worker from
  // the profile's SW script cache even after the files on disk change. Drop the
  // registrations (not CacheStorage, which holds the downloaded model).
  for (const sub of ['ScriptCache', 'Database']) {
    fs.rmSync(path.join(profile, 'Default', 'Service Worker', sub), { recursive: true, force: true });
  }
  const downloads = fs.mkdtempSync(path.join(TMP, 'vox-downloads-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: BRAVE,
    headless: false,
    acceptDownloads: true,
    downloadsPath: downloads,
    viewport: { width: 1200, height: 860 },
    ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
    args: [
      `--disable-extensions-except=${exts.join(',')}`,
      `--load-extension=${exts.join(',')}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  const errors = [];
  const findSw = (needle) => ctx.serviceWorkers().find((w) => w.url().includes(needle));
  let sw = findSw('background/service_worker.js');
  const deadline = Date.now() + 20000;
  while (!sw && Date.now() < deadline) {
    await ctx.waitForEvent('serviceworker', { timeout: 2000 }).catch(() => null);
    sw = findSw('background/service_worker.js');
  }
  if (!sw) throw new Error('Vox service worker not found');
  const extId = new URL(sw.url()).host;
  sw.on('console', (m) => { if (m.type() === 'error') errors.push(`[sw] ${m.text()}`); });
  let focusSw = null;
  if (withFocusReader) {
    for (let i = 0; i < 40 && !focusSw; i++) {
      focusSw = ctx.serviceWorkers().find((w) => w.url().endsWith('/background.js'));
      if (!focusSw) await new Promise((r) => setTimeout(r, 250));
    }
  }
  // Lifecycle of the offscreen document (crash/close) for diagnostics.
  const lifecycle = [];
  const t0 = Date.now();
  try {
    const cdp = await ctx.browser().newBrowserCDPSession();
    const names = {};
    cdp.on('Target.targetCreated', (e) => {
      names[e.targetInfo.targetId] = e.targetInfo.url;
      if (e.targetInfo.url.includes('offscreen')) lifecycle.push(`${((Date.now() - t0) / 1000).toFixed(1)}s offscreen created`);
    });
    cdp.on('Target.targetDestroyed', (e) => {
      if ((names[e.targetId] || '').includes('offscreen')) lifecycle.push(`${((Date.now() - t0) / 1000).toFixed(1)}s offscreen destroyed`);
    });
    cdp.on('Target.targetCrashed', (e) => lifecycle.push(`${((Date.now() - t0) / 1000).toFixed(1)}s target crashed ${names[e.targetId] || e.targetId} ${e.status}`));
    await cdp.send('Target.setDiscoverTargets', { discover: true });
  } catch (_) { /* diagnostics only */ }
  return { ctx, sw, extId, focusSw, errors, downloads, profile, lifecycle };
}

/** Open a page, wait for Vox + the speech mock. Throws if the mock is missing. */
export async function openPage(env, url) {
  const page = await env.ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') env.errors.push(`[page] ${m.text()}`); });
  page.on('pageerror', (e) => env.errors.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  await assertMocked(page);
  return page;
}

export async function assertMocked(page) {
  await page.waitForFunction(() => document.documentElement.dataset.voxReaderLoaded === 'true', null, { timeout: 15000 });
  const mocked = await page.evaluate(() => document.documentElement.dataset.voxSpeechMock === '1');
  if (!mocked) throw new Error('SAFETY: speechSynthesis mock not active in Vox isolated world, aborting');
}

export async function shot(page, name) {
  const file = path.join(evidenceDir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** Run fn in Vox's service worker. */
export function inSw(env, fn, arg) { return env.sw.evaluate(fn, arg); }

/** Send a Vox-internal message to a tab's content script from the SW (like a command). */
export async function tabCommand(env, page, action, extra = {}) {
  const url = page.url();
  return env.sw.evaluate(async ({ url, action, extra }) => {
    // Newest tab with this URL (an older one may still be open).
    const tab = (await chrome.tabs.query({})).filter((t) => t.url === url).sort((a, b) => b.id - a.id)[0];
    await chrome.tabs.sendMessage(tab.id, { action, ...extra });
    return tab.id;
  }, { url, action, extra });
}

/** Wait until the model is loaded (Settings install panel hidden and status says ready / Playing). */
export async function waitForKokoroReady(page, timeout = 600000) {
  await page.waitForFunction(() => {
    const host = document.getElementById('vox-player');
    const root = host?.shadowRoot || document;
    const st = root.getElementById('vox-status')?.textContent || '';
    return /ready|Playing|Generating|Done/i.test(st) && !/Downloading/i.test(st);
  }, null, { timeout, polling: 1000 });
}

export function report(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}
