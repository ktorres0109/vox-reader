// End-to-end feature check in real Brave (muted, speech mocked). Run:
//   node tests/brave/features.mjs            # all scenarios
//   node tests/brave/features.mjs offline    # one scenario by name
// Screenshots + a JSON log go to $TMPDIR/vox-evidence/.
import fs from 'node:fs';
import path from 'node:path';
import {
  launch, openPage, assertMocked, startFixtureServer, tabCommand, shot, report, evidenceDir,
} from './harness.mjs';

const only = process.argv[2];
const log = {};
const record = (k, v) => { log[k] = v; };

// ── helpers ────────────────────────────────────────────────────────────────
const inPlayer = (page, fn, arg) => page.evaluate(([src, a]) => {
  const root = document.getElementById('vox-player')?.shadowRoot;
  return new Function('root', 'arg', `return (${src})(root, arg)`)(root, a);
}, [fn.toString(), arg]);
const status = (page) => inPlayer(page, (r) => r?.getElementById('vox-status')?.textContent || '');

async function waitStatus(page, re, timeout = 60000) {
  const t0 = Date.now();
  let s = '';
  while (Date.now() - t0 < timeout) {
    s = await status(page);
    if (re.test(s)) return s;
    await page.waitForTimeout(250);
  }
  throw new Error(`status ${re} not reached; last="${s}"`);
}

async function installTap(env) {
  await env.sw.evaluate(() => {
    if (globalThis.__tap) { Object.assign(globalThis.__tap, { speak: [], chunks: [], debug: [], caches: null }); return; }
    globalThis.__tap = { speak: [], chunks: [], debug: [], caches: null };
    chrome.runtime.onMessage.addListener((m) => {
      const t = globalThis.__tap;
      if (m.action === 'kokoro_speak') t.speak.push(m);
      if (m.action === 'kokoro_chunk') t.chunks.push({ ...m, recvAt: Date.now() });
      if (m.action === 'kokoro_debug_state_result') t.debug.push(m.state);
      if (m.action === 'kokoro_debug_caches_result') t.caches = m.result || { error: m.error };
    });
  });
}
const tap = (env) => env.sw.evaluate(() => globalThis.__tap);
const resetTap = (env) => env.sw.evaluate(() => { const t = globalThis.__tap; t.speak = []; t.chunks = []; t.debug = []; });

async function offscreen(env, action, resultKey) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await offscreenOnce(env, action, resultKey);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 500));
  }
  console.log('  offscreen query failed:', await env.sw.evaluate(async () => ({ err: globalThis.__tap.lastSendErr, has: await chrome.offscreen.hasDocument() })).then(JSON.stringify));
  return null;
}
async function offscreenOnce(env, action, resultKey) {
  return env.sw.evaluate(async ({ action, resultKey }) => {
    const t = globalThis.__tap;
    if (resultKey === 'debug') t.debug = []; else t.caches = null;
    let sendErr = null;
    await chrome.runtime.sendMessage({ target: 'offscreen', action }).catch((e) => { sendErr = String(e); });
    if (sendErr) { t.lastSendErr = sendErr; return null; }
    for (let i = 0; i < 100; i++) {
      if (resultKey === 'debug' ? t.debug.length : t.caches) return resultKey === 'debug' ? t.debug[0] : t.caches;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  }, { action, resultKey });
}

async function openReady(env, url) {
  const page = await openPage(env, url);
  await tabCommand(env, page, 'toggle_player');
  await waitStatus(page, /ready|Ready/i, 600000);
  return page;
}

async function play(page) {
  await page.locator('#vox-playpause-bar').click();
  await waitStatus(page, /Playing/, 60000);
  await page.evaluate(() => document.activeElement?.blur?.()); // keyboard tests need page focus
}

const activeSentence = (page, root = 'document') => page.evaluate((root) => {
  const scope = root === 'focus' ? document.getElementById('focus-reader-host').shadowRoot : document;
  const els = [...scope.querySelectorAll('.vox-sentence-active')];
  return { first: els[0] ? Number(els[0].dataset.voxIndex) : -1, text: els.map((e) => e.textContent).join(' ').slice(0, 120) };
}, root);
const activeWord = (page) => page.evaluate(() => {
  const el = document.querySelector('.vox-word-active');
  return el ? { idx: Number(el.dataset.voxIndex), text: el.textContent } : null;
});

// ── scenarios ──────────────────────────────────────────────────────────────
const scenarios = {
  async player(env, base) {
    const page = await openReady(env, `${base}/long-article.html`);
    const look = await inPlayer(page, (r) => ({
      tag: r.host.tagName,
      playBg: getComputedStyle(r.getElementById('vox-playpause-bar')).backgroundColor,
      hostBorder: getComputedStyle(r.host).borderTopStyle,
      ids: ['vox-back-bar', 'vox-playpause-bar', 'vox-fwd-bar', 'vox-progress', 'vox-time-left', 'vox-speed-pill', 'vox-voice-pill', 'vox-settings-btn']
        .filter((id) => !r.getElementById(id)),
    }));
    record('player.look', look);
    report('player in shadow DOM, site CSS does not leak', look.tag === 'VOX-READER-PLAYER' && look.playBg === 'rgb(245, 158, 11)' && look.hostBorder === 'none' && !look.ids.length, JSON.stringify(look));
    const left = await inPlayer(page, (r) => r.getElementById('vox-time-left').textContent);
    report('scrubber shows "N min left" before playing', /min left/.test(left), left);
    await shot(page, '01-player-bar');
    await page.locator('#vox-speed-pill').click();
    await shot(page, '02-speed-menu');
    await page.locator('.vox-speed-opt[data-speed="1.25"]').click();
    const pill = await page.locator('#vox-speed-pill').textContent();
    report('speed menu sets 1.25×', pill === '1.25×', pill);
    await page.locator('.vox-speed-opt[data-speed="1"]').click();
    await page.locator('#vox-voice-pill').click();
    const voiceMenu = await inPlayer(page, (r) => ({ open: r.getElementById('vox-voice-menu').classList.contains('open'), voices: r.getElementById('vox-kokoro-voice-select').options.length }));
    report('voice menu opens with Kokoro voices', voiceMenu.open && voiceMenu.voices >= 10, JSON.stringify(voiceMenu));
    await shot(page, '03-voice-menu');
    await page.locator('#vox-settings-btn').click();
    await shot(page, '04-settings-popover');
    await page.locator('#vox-settings-close').click();
    await page.close();
  },

  async cleaning(env, base) {
    await resetTap(env);
    const page = await openReady(env, `${base}/long-article.html`);
    await play(page);
    await page.waitForTimeout(1500);
    const t = await tap(env);
    const text = t.speak.at(-1).sentences.map((s) => s.text).join(' ');
    record('cleaning.spokenText', text);
    const bad = ['[1]', '[2]', '[3]', '[citation', 'needed]', '[a]', 'https://', 'www.', '¹', 'manuscripts. 2'].filter((x) => text.includes(x));
    report('citations/URLs/footnotes removed from speech', !bad.length && text.includes('example.com') && text.includes('wikipedia.org'), bad.join(',') || 'ok');
    const shown = await page.evaluate(() => document.body.innerText.includes('[citation needed]') && document.body.innerText.includes('https://example.com'));
    report('displayed text unchanged (highlight mapping intact)', shown);
    const sentOk = t.speak.at(-1).sentences.slice(0, 3).map((s) => s.text);
    record('cleaning.firstSentences', sentOk);
    report('sentence split uses cleaned text + block boundaries', sentOk[0] === 'The History of Reading Aloud' && sentOk[1].endsWith('history.') && sentOk[2] === 'Silent reading only became common much later.', JSON.stringify(sentOk));
    await page.locator('#vox-close-bar').click();
    await page.close();
  },

  async gapless(env, base) {
    await resetTap(env);
    const page = await openReady(env, `${base}/long-article.html`);
    await play(page);
    await page.waitForTimeout(14000);
    const dbg = await offscreen(env, 'kokoro_debug_state', 'debug');
    const t = await tap(env);
    const session = t.speak.at(-1).session;
    const chunks = t.chunks.filter((c) => c.session === session).sort((a, b) => a.index - b.index);
    const gaps = [];
    for (let i = 1; i < chunks.length; i++) {
      if (chunks[i].index !== chunks[i - 1].index + 1) continue;
      gaps.push(Math.round(chunks[i].startedAt - (chunks[i - 1].startedAt + chunks[i - 1].duration * 1000)));
    }
    const sched = dbg?.session?.scheduled || [];
    const schedGaps = sched.slice(1).map((x, i) => +(x.when - (sched[i].when + sched[i].d)).toFixed(6));
    console.log('  backend', dbg?.backend, 'synth', JSON.stringify(dbg?.synth));
    record('gapless', { chunks: chunks.map((c) => ({ i: c.index, at: Math.round(c.startedAt), d: +c.duration.toFixed(3), early: Math.round(c.startedAt - c.recvAt) })), gaps, dbg, schedGaps });
    report('consecutive sentences scheduled back to back (audio clock)', gaps.length >= 3 && gaps.every((g) => Math.abs(g) <= 2) && schedGaps.every((g) => Math.abs(g) < 1e-6), `gaps(ms)=${gaps.join(',')} sched=${schedGaps.join(',')}`);
    report('next chunk announced before it starts (pre-synthesized)', chunks.slice(1).some((c) => c.startedAt - c.recvAt > 200), chunks.map((c) => Math.round(c.startedAt - c.recvAt)).join(','));
    report('AudioContext clock runs under --mute-audio', dbg?.ctxState === 'running' && dbg.ctxTime > 5, JSON.stringify({ s: dbg?.ctxState, t: dbg?.ctxTime }));
    // highlight follows audio across sentence boundaries
    const seen = new Set();
    for (let i = 0; i < 16; i++) { seen.add((await activeSentence(page)).first); await page.waitForTimeout(500); }
    report('sentence highlight advances in sync', seen.size >= 2, [...seen].join(','));
    await shot(page, '05-playing-word-highlight');

    // Pause (Space) freezes the clock; resume continues
    console.log('  step: pause');
    await page.keyboard.press(' ');
    await waitStatus(page, /Paused/, 5000);
    console.log('  step: paused, querying offscreen');
    const p1 = await offscreen(env, 'kokoro_debug_state', 'debug');
    console.log('  step: p1', !!p1);
    const w1 = await activeWord(page);
    await page.waitForTimeout(2500);
    console.log('  diag', JSON.stringify(await env.sw.evaluate(async () => ({ has: await chrome.offscreen.hasDocument(), tap: !!globalThis.__tap, dbg: globalThis.__tap?.debug?.length, ctx: (await chrome.runtime.getContexts({})).map((c) => c.contextType) }))));
    const p2 = await offscreen(env, 'kokoro_debug_state', 'debug');
    console.log('  step: p2', !!p2);
    const w2 = await activeWord(page);
    report('Space pauses: context suspended, clock + highlight frozen', p1.ctxState === 'suspended' && Math.abs(p2.ctxTime - p1.ctxTime) < 0.05 && w1?.idx === w2?.idx, `${p1.ctxState} dt=${(p2.ctxTime - p1.ctxTime).toFixed(3)} w=${w1?.idx}/${w2?.idx}`);
    await page.keyboard.press(' ');
    await waitStatus(page, /Playing/, 5000);
    await page.waitForTimeout(2500);
    const w3 = await activeWord(page);
    report('Space resumes from the same spot', /Playing/.test(await status(page)) && w3 && w3.idx >= (w2?.idx ?? 0) && w3.idx - (w2?.idx ?? 0) < 40, `w=${w2?.idx}->${w3?.idx}`);

    // Arrow keys = sentence nav; ] = faster
    const before = (await activeSentence(page)).first;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(2500);
    const after = (await activeSentence(page)).first;
    report('→ jumps to next sentence', after > before, `${before} -> ${after}`);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(400);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(2500);
    const back = (await activeSentence(page)).first;
    report('← goes back a sentence', back < after, `${after} -> ${back}`);
    await page.keyboard.press(']');
    await page.waitForTimeout(300);
    const pill = await page.locator('#vox-speed-pill').textContent();
    report('] raises speed', pill === '1.1×', pill);
    await page.keyboard.press('[');
    await page.waitForTimeout(300);
    // typing in an input must not trigger shortcuts
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'probe'; document.body.prepend(i); });
    await page.locator('#probe').focus();
    await page.keyboard.press(' ');
    await page.waitForTimeout(400);
    const stillPlaying = await inPlayer(page, (r) => r.getElementById('vox-playpause-bar').getAttribute('aria-label') === 'Pause');
    const typed = await page.locator('#probe').inputValue();
    report('shortcuts ignored while typing (Space typed into the field, playback continues)', stillPlaying && typed === ' ', `playing=${stillPlaying} typed=${JSON.stringify(typed)}`);
    await page.evaluate(() => document.getElementById('probe').remove());

    const left = await inPlayer(page, (r) => r.getElementById('vox-time-left').textContent);
    report('time-left updates during playback', /min left/.test(left), left);

    // If the browser closes the offscreen doc mid-read, reading continues.
    const beforeLoss = (await activeSentence(page)).first;
    await env.sw.evaluate(async () => { if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument(); });
    await page.waitForTimeout(9000);
    const afterLoss = (await activeSentence(page)).first;
    const st2 = await status(page);
    report('recovers when the browser closes the offscreen doc mid-read', /Playing/.test(st2) && afterLoss >= beforeLoss, `${beforeLoss} -> ${afterLoss} status=${st2}`);

    // Back-to-reading pill
    await page.mouse.move(600, 300);
    await page.mouse.wheel(0, 6000);
    await page.waitForTimeout(1500);
    const pillShown = await inPlayer(page, (r) => !r.getElementById('vox-back-to-reading').classList.contains('vs-hidden'));
    await shot(page, '06-back-to-reading-pill');
    await page.locator('#vox-back-to-reading').click();
    await page.waitForTimeout(1500);
    const inView = await page.evaluate(() => { const r = document.querySelector('.vox-sentence-active')?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight; });
    report('"Back to reading" pill appears when scrolled away and returns', pillShown && inView, `shown=${pillShown} inView=${inView}`);
    await page.locator('#vox-close-bar').click();
    await page.close();
  },

  async highlight(env, base) {
    const page = await openReady(env, `${base}/long-article.html`);
    await page.locator('#vox-settings-btn').click();
    await page.locator('#hl-mode button[data-value="sentence"]').click();
    await page.locator('#vox-settings-close').click();
    await play(page);
    await page.waitForTimeout(3000);
    const counts = await page.evaluate(() => ({ word: document.querySelectorAll('.vox-word-active').length, sent: document.querySelectorAll('.vox-sentence-active').length }));
    await shot(page, '07-sentence-highlight-mode');
    report('sentence mode: sentence fill, no word box', counts.word === 0 && counts.sent > 3, JSON.stringify(counts));
    await page.locator('#vox-settings-btn').click();
    await page.locator('#hl-mode button[data-value="off"]').click();
    await page.waitForTimeout(800);
    const off = await page.evaluate(() => document.querySelectorAll('.vox-word-active, .vox-sentence-active').length);
    report('off mode: no highlight', off === 0, String(off));
    await page.locator('#hl-mode button[data-value="word"]').click();
    await page.waitForTimeout(1200);
    const word = await page.evaluate(() => document.querySelectorAll('.vox-word-active').length);
    report('word mode restores word highlight', word === 1, String(word));
    await page.locator('#vox-settings-close').click();
    await page.locator('#vox-close-bar').click();
    await page.close();
  },

  async themes(env, base) {
    const page = await openReady(env, `${base}/long-article.html`);
    await page.locator('#vox-settings-btn').click();
    for (const theme of ['sepia', 'light', 'dark']) {
      await page.locator(`#theme-seg button[data-value="${theme}"]`).click();
      const bg = await inPlayer(page, (r) => [r.host.dataset.theme, getComputedStyle(r.getElementById('vox-bar')).backgroundColor]);
      record(`theme.${theme}`, bg);
      report(`theme ${theme} applies to player`, bg[0] === theme, bg.join(' '));
      await shot(page, `08-theme-${theme}`);
    }
    await page.locator('#font-seg button[data-value="sans"]').click();
    await page.locator('#width-seg button[data-value="narrow"]').click();
    await page.locator('#line-seg button[data-value="2.1"]').click();
    await page.locator('#size-up').click();
    await page.locator('#theme-seg button[data-value="sepia"]').click();
    await page.locator('#vox-settings-close').click();
    await page.locator('#vox-immersive-btn').click();
    await page.waitForTimeout(800);
    const imm = await page.evaluate(() => {
      const ov = document.getElementById('vox-immersive');
      const c = document.getElementById('vox-immersive-content');
      const cs = getComputedStyle(c);
      return { theme: ov.dataset.theme, bg: getComputedStyle(ov).backgroundColor, font: cs.fontFamily, size: cs.fontSize, line: cs.lineHeight, width: getComputedStyle(document.getElementById('vox-immersive-inner')).maxWidth };
    });
    record('immersive', imm);
    await shot(page, '09-immersive-sepia');
    report('immersive reader uses theme/font/size/width/spacing', imm.theme === 'sepia' && /apple-system|system-ui/.test(imm.font) && imm.size === '20px' && imm.width === '560px' && parseFloat(imm.line) / parseFloat(imm.size) > 2, JSON.stringify(imm));
    await page.locator('#vox-immersive-exit').click();
    // restore defaults for later scenarios
    await page.locator('#vox-settings-btn').click();
    for (const [g, v] of [['theme-seg', 'dark'], ['font-seg', 'serif'], ['width-seg', 'medium'], ['line-seg', '1.8']]) await page.locator(`#${g} button[data-value="${v}"]`).click();
    await page.locator('#size-down').click();
    await page.locator('#vox-settings-close').click();
    await page.close();
  },

  async media(env, base) {
    const page = await openReady(env, `${base}/long-article.html`);
    await play(page);
    await page.waitForTimeout(2000);
    const st = await offscreen(env, 'kokoro_debug_state', 'debug');
    record('media', st?.media);
    report('offscreen media session: metadata + routed through <audio>', st?.media?.supported && st.media.routedThroughElement && st.media.playbackState === 'playing' && /Vox long article/.test(st.media.title || ''), JSON.stringify(st?.media));
    // Simulate the OS pressing pause: the handler path is offscreen -> SW -> tab.
    await env.sw.evaluate(async (url) => {
      const [tab] = (await chrome.tabs.query({})).filter((t) => t.url === url);
      await chrome.tabs.sendMessage(tab.id, { action: 'kokoro_media', key: 'pause' });
    }, page.url());
    const paused = await waitStatus(page, /Paused/, 4000).then(() => true).catch(() => false);
    const st2 = await offscreen(env, 'kokoro_debug_state', 'debug');
    report('media "pause" action pauses; session state follows', paused && st2?.media?.playbackState === 'paused', JSON.stringify(st2?.media));
    await page.locator('#vox-close-bar').click();
    await page.close();
  },

  async resume(env, base) {
    await env.sw.evaluate(() => chrome.storage.local.remove('voxPositions'));
    const url = `${base}/long-article.html`;
    let page = await openReady(env, url);
    await play(page);
    for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(700); }
    await page.waitForTimeout(2500);
    const saved = (await activeSentence(page)).first;
    await page.locator('#vox-close-bar').click(); // stop() saves the position
    await page.waitForTimeout(500);
    const store = await env.sw.evaluate(() => chrome.storage.local.get('voxPositions'));
    record('resume.store', store);
    await page.reload();
    await assertMocked(page);
    await tabCommand(env, page, 'toggle_player');
    await page.waitForTimeout(1500);
    const banner = await inPlayer(page, (r) => ({ visible: !r.getElementById('vox-resume').classList.contains('vs-hidden'), text: r.getElementById('vox-resume-text').textContent }));
    await shot(page, '10-resume-prompt');
    report('reopen shows "Resume from N%?"', banner.visible && /Resume from \d+%\?/.test(banner.text), banner.text);
    await page.locator('#vox-resume-yes').click();
    await waitStatus(page, /Playing/, 30000);
    await page.waitForTimeout(800);
    const now = (await activeSentence(page)).first;
    report('Resume continues at the saved sentence', now >= saved - 1 && now <= saved + 25, `saved=${saved} now=${now}`);
    await page.locator('#vox-close-bar').click();
    await page.close();
    page = await openPage(env, `${base}/long-article.html#section`);
    await tabCommand(env, page, 'toggle_player');
    await page.waitForTimeout(1500);
    const again = await inPlayer(page, (r) => !r.getElementById('vox-resume').classList.contains('vs-hidden'));
    report('position keyed by URL without #hash', again);
    await page.locator('#vox-resume-no').click();
    await waitStatus(page, /Playing|Generating/, 30000);
    const first = (await activeSentence(page)).first;
    report('Start over reads from the top', first >= 0 && first < 30, String(first));
    await page.locator('#vox-close-bar').click();
    await page.close();
  },

  async cache(env) {
    const c = await offscreen(env, 'kokoro_debug_caches', 'caches');
    const summary = {};
    for (const [name, entries] of Object.entries(c?.caches || {})) {
      summary[name] = { files: entries.length, mb: +(entries.reduce((s, e) => s + e.bytes, 0) / 1048576).toFixed(1), urls: entries.map((e) => e.url) };
    }
    record('cache', { origin: c?.origin, summary, estimate: c?.estimate });
    console.log(JSON.stringify({ origin: c?.origin, summary }, null, 1));
    report('model cached in offscreen origin Cache Storage', !!summary['transformers-cache'] && summary['transformers-cache'].urls.some((u) => /model_quantized\.onnx/.test(u)), `${c?.origin} files=${summary['transformers-cache']?.files}`);
  },

  async offline(env, base) {
    // Fresh offscreen doc so the model must load from the Cache API, then cut the network.
    await env.sw.evaluate(async () => { if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument(); });
    const blocked = [];
    await env.ctx.route(/huggingface\.co|hf\.co|jsdelivr\.net|cdn-lfs|xethub/, (route) => { blocked.push(route.request().url()); route.abort(); });
    const page = await openPage(env, `${base}/long-article.html`);
    await env.ctx.setOffline(true);
    const online = await page.evaluate(() => navigator.onLine);
    await resetTap(env);
    await tabCommand(env, page, 'toggle_player');
    await waitStatus(page, /ready|Ready/i, 60000);
    await page.locator('#vox-playpause-bar').click();
    const ok = await waitStatus(page, /Playing/, 90000).then(() => true).catch((e) => e.message);
    await page.waitForTimeout(3000);
    const t = await tap(env);
    await shot(page, '11-offline-playing');
    record('offline', { navigatorOnLine: online, chunks: t.chunks.length, blocked, status: await status(page) });
    const dbgOff = await offscreen(env, 'kokoro_debug_state', 'debug');
    record('offline.backend', dbgOff?.backend);
    report('offline (setOffline + HF/CDN blocked): model loads from cache and speaks', ok === true && t.chunks.length >= 1, `backend=${dbgOff?.backend} onLine=${online} chunks=${t.chunks.length} blockedRequests=${blocked.length} ${ok === true ? '' : ok}`);
    await page.locator('#vox-close-bar').click();

    // Same offline check on the CPU (wasm q8) backend.
    await tabCommand(env, page, 'toggle_player');
    await page.locator('#vox-voice-pill').click();
    await page.locator('#device-seg button[data-value="wasm"]').click();
    await page.locator('#vox-voice-pill').click();
    await resetTap(env);
    await waitStatus(page, /ready/i, 120000); // CPU model reloads from cache, offline
    await page.locator('#vox-playpause-bar').click();
    const ok2 = await waitStatus(page, /Playing/, 120000).then(() => true).catch((e) => e.message);
    const dbgCpu = await offscreen(env, 'kokoro_debug_state', 'debug');
    const t2 = await tap(env);
    await shot(page, '11b-offline-playing-cpu');
    record('offline.cpu', { backend: dbgCpu?.backend, chunks: t2.chunks.length, synth: dbgCpu?.synth });
    report('offline on CPU backend (wasm q8) also speaks', ok2 === true && dbgCpu?.backend === 'wasm' && t2.chunks.length >= 1, `backend=${dbgCpu?.backend} chunks=${t2.chunks.length} ${ok2 === true ? '' : ok2}`);
    await page.locator('#vox-voice-pill').click();
    await page.locator('#device-seg button[data-value="auto"]').click();
    await page.locator('#vox-close-bar').click();
    await env.ctx.setOffline(false);
    await env.ctx.unrouteAll({ behavior: 'ignoreErrors' });
    await page.close();
  },
};

async function focusScenario(base) {
  const env = await launch({ withFocusReader: true });
  try {
    await installTap(env);
    report('focus-reader extension loaded alongside', !!env.focusSw, env.focusSw?.url());
    const page = await openReady(env, `${base}/long-article.html`);
    await page.locator('#vox-close-bar').click();
    // Open Focus Reader the way its toolbar button does (test copy has host access).
    console.log('  step: open focus reader');
    const opened = await env.focusSw.evaluate(async (url) => {
      try {
        const [tab] = (await chrome.tabs.query({})).filter((t) => t.url === url);
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['__speech_mock.js', 'Readability.js', 'reader.js'] });
        return 'ok';
      } catch (e) { return String(e); }
    }, page.url());
    console.log('  step: focus open ->', opened);
    await page.waitForFunction(() => !!document.getElementById('focus-reader-host')?.shadowRoot?.querySelector('article'), null, { timeout: 10000 });
    const focusMock = await page.evaluate(() => document.documentElement.dataset.focusSpeechMock === '1');
    if (!focusMock) throw new Error('SAFETY: focus-reader speech mock missing');

    // 1) ping + read from Focus Reader's own content-script world (sender.tab path)
    console.log('  step: ping');
    const pong = await env.focusSw.evaluate(async (id) => chrome.runtime.sendMessage(id, { action: 'vox_ping' }).catch((e) => String(e)), env.extId);
    report('vox_ping from another extension', pong?.ok && pong.version, JSON.stringify(pong));
    const articleText = await page.evaluate(() => document.getElementById('focus-reader-host').shadowRoot.querySelector('.content').innerText);
    const res = await env.focusSw.evaluate(async ({ url, id, text }) => {
      const [tab] = (await chrome.tabs.query({})).filter((t) => t.url === url);
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (vid, txt) => chrome.runtime.sendMessage(vid, { action: 'vox_read', text: txt, title: 'Focus Reader article' }),
        args: [id, text],
      });
      return r.result;
    }, { url: page.url(), id: env.extId, text: articleText });
    report('vox_read accepted from Focus Reader content script', res?.ok === true, JSON.stringify(res));
    await waitStatus(page, /Playing/, 60000);
    await page.waitForTimeout(2500);
    const inFocus = await activeSentence(page, 'focus');
    const onTop = await page.evaluate(() => {
      const host = document.getElementById('vox-player');
      const r = host.shadowRoot.getElementById('vox-bar').getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === host;
    });
    await shot(page, '12-focus-reader-vox-reading');
    report('Vox highlights inside Focus Reader shadow root', inFocus.first >= 0 && inFocus.text.length > 10, inFocus.text.slice(0, 60));
    report('Vox player stays above Focus Reader overlay', onTop);
    await page.locator('#vox-close-bar').click();

    // 2) Vox's own Play button reads the Focus Reader article, not the page behind it
    await tabCommand(env, page, 'toggle_player');
    await page.locator('#vox-playpause-bar').click();
    await waitStatus(page, /Playing/, 60000);
    await page.waitForTimeout(2000);
    const own = await activeSentence(page, 'focus');
    const pageWords = await page.evaluate(() => document.querySelectorAll('article .vox-word').length);
    report('Play while Focus Reader is open reads its article', own.first >= 0 && pageWords === 0, `focusSentence=${own.first} underlyingPageWords=${pageWords}`);
    await page.locator('#vox-close-bar').click();

    // 3) text that is not on the page: read without in-page highlight, from a background sender
    const res2 = await env.focusSw.evaluate(async ({ url, id }) => {
      const [tab] = (await chrome.tabs.query({})).filter((t) => t.url === url);
      return chrome.runtime.sendMessage(id, { action: 'vox_read', text: 'This sentence is not on the page. It is read from a message.', title: 'Snippet', tabId: tab.id });
    }, { url: page.url(), id: env.extId });
    const played = await waitStatus(page, /Playing/, 60000).then(() => true).catch(() => false);
    report('vox_read with explicit tabId (background sender) plays off-page text', res2?.ok && played, JSON.stringify(res2));
    await page.locator('#vox-close-bar').click();
    report('no console/page errors (focus run)', !env.errors.filter((e) => !/404/.test(e)).length, env.errors.join(' | '));
  } finally {
    await env.ctx.close();
  }
}

// ── main ───────────────────────────────────────────────────────────────────
const srv = await startFixtureServer();
try {
  if (!only || only !== 'focus') {
    const env = await launch();
    try {
      await installTap(env);
      for (const [name, fn] of Object.entries(scenarios)) {
        if (only && only !== name) continue;
        console.log(`\n== ${name}`);
        try { await fn(env, srv.base); } catch (err) { report(`${name} scenario ran`, false, err.message.split('\n')[0]); }
        for (const p of env.ctx.pages()) if (p.url().startsWith(srv.base)) await p.close().catch(() => {});
      }
      report('no console/page/worker errors', !env.errors.filter((e) => !/404/.test(e)).length, env.errors.join(' | '));
      console.log('offscreen lifecycle:', env.lifecycle.join(' | ') || '(none)');
      record('lifecycle', env.lifecycle);
    } finally {
      await env.ctx.close();
    }
  }
  if (!only || only === 'focus') {
    console.log('\n== focus');
    try { await focusScenario(srv.base); } catch (err) { report('focus scenario ran', false, err.message.split('\n')[0]); }
  }
} finally {
  srv.stop();
  fs.writeFileSync(path.join(evidenceDir, 'features-log.json'), JSON.stringify(log, null, 2));
  console.log(`\nEvidence: ${evidenceDir}`);
}
