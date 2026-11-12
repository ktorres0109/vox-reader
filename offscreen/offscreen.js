// Vox Reader — Kokoro 82M neural TTS (offscreen document)
// Uses kokoro-js for multi-voice synthesis (Bella, Sarah, etc.)
//
// Playback is gapless: each sentence is synthesized ahead of time and scheduled
// on the AudioContext clock with AudioBufferSourceNode.start(when), back to back.
// Pause suspends the AudioContext (the clock freezes, scheduled audio waits);
// resume re-sends the timing of every scheduled chunk so highlights re-sync.

import { KokoroTTS } from '../vendor/kokoro.web.js';
import { encodeWav, bytesToBase64 } from './wav.js';
import { encodeMp3 } from './mp3.js';
import { createMediaSession } from './media-session.js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const LOOKAHEAD = 2;          // sentences synthesized ahead of the one playing
const SCHEDULE_LEAD_SEC = 0.06;

let tts = null;
let audioCtx = null;
let outputNode = null;
let exportGeneration = 0;
let exportInProgress = false;
let loadGeneration = 0;
let modelLoadingPromise = null;
let currentVoice = 'af_bella';

/** Active read: one per offscreen document. */
let session = null;
let sessionCounter = 0;
const synthCache = new Map();
const loadWaiters = new Set(); // tabIds waiting for a kokoro_load to finish
let synthChain = Promise.resolve(); // tts.generate calls are serialized
const synthStats = []; // recent synthesis timings (diagnostics)

const media = createMediaSession({
  onAction: (key) => {
    if (session) send({ action: 'kokoro_media', key, tabId: session.tabId });
  },
});

function send(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function reportProgress(tabId, data) {
  if (!tabId) return;
  let pct = 0;
  if (typeof data.progress === 'number') pct = Math.round(data.progress);
  else if (data.loaded && data.total) pct = Math.round((data.loaded / data.total) * 100);
  send({
    action: 'kokoro_progress',
    tabId,
    pct,
    file: data.file || data.name || '',
    status: data.status || '',
  });
}

async function warmVoice(voice, tabId) {
  if (!tts) return;
  const v = voice || currentVoice;
  if (tabId) {
    reportProgress(tabId, { progress: 99, status: 'Initializing AI voice…' });
  }
  try {
    await queueSynth(() => tts.generate('Ready.', { voice: v, speed: 1 }));
  } catch (_) { /* voice file fetch may fail offline — speak will retry */ }
}

// Backends, fastest first. WebGPU runs Kokoro well faster than real time
// and keeps this document's only thread free; it needs the fp32 weights
// (~330 MB, cached after the first download). wasm q8 (~88 MB) runs on one
// CPU thread at roughly 1.3-2x real time. Any WebGPU failure (no adapter,
// offline without the fp32 weights cached, shader error) falls back to wasm.
const BACKENDS = {
  webgpu: { device: 'webgpu', dtype: 'fp32' },
  wasm: { device: 'wasm', dtype: 'q8' },
};
let devicePref = 'auto';   // 'auto' | 'wasm'
let activeBackend = null;  // 'webgpu' | 'wasm' once loaded
const backendErrors = {};

function backendPlan() {
  return devicePref !== 'wasm' && navigator.gpu ? ['webgpu', 'wasm'] : ['wasm'];
}

async function loadBackend(name, thisGen, progress) {
  const { device, dtype } = BACKENDS[name];
  if (device === 'webgpu' && !(await navigator.gpu.requestAdapter())) throw new Error('no WebGPU adapter');
  const model = await KokoroTTS.from_pretrained(MODEL_ID, { dtype, device, progress_callback: progress });
  if (thisGen !== loadGeneration) throw new Error('Download cancelled');
  // Prove the backend actually produces audio before trusting it.
  const probe = await model.generate('Ready.', { voice: currentVoice, speed: 1 });
  const samples = probe?.audio || probe?.data;
  if (!samples || samples.length < 1000) throw new Error(`${name} produced no audio`);
  return model;
}

async function loadModel(tabId, voice, pref) {
  if (voice) currentVoice = voice;
  if (pref === 'auto' || pref === 'wasm') {
    if (pref !== devicePref && tts && activeBackend === 'webgpu' && pref === 'wasm') {
      tts = null; // user asked for CPU only: reload on wasm
      activeBackend = null;
    }
    devicePref = pref;
  }
  if (tts) {
    await warmVoice(currentVoice, tabId);
    return;
  }
  if (modelLoadingPromise) return modelLoadingPromise;

  const thisGen = ++loadGeneration;
  const progress = (data) => {
    if (thisGen !== loadGeneration) return;
    if (loadWaiters.size) {
      for (const tid of loadWaiters) reportProgress(tid, data);
    } else {
      reportProgress(tabId, data);
    }
  };
  const p = (async () => {
    let lastErr = null;
    for (const name of backendPlan()) {
      try {
        const model = await loadBackend(name, thisGen, progress);
        activeBackend = name;
        return model;
      } catch (err) {
        if (thisGen !== loadGeneration || err.message === 'Download cancelled') throw err;
        backendErrors[name] = String(err?.message || err);
        lastErr = err;
      }
    }
    throw lastErr || new Error('No TTS backend available');
  })().then(async (model) => {
    if (thisGen !== loadGeneration) throw new Error('Download cancelled');
    tts = model;
    if (modelLoadingPromise === p) modelLoadingPromise = null;
    await warmVoice(currentVoice, tabId);
    if (thisGen !== loadGeneration) throw new Error('Download cancelled');
  }).catch((err) => {
    // Only clear if this promise is still the active one — a cancelled load
    // must not wipe the pointer to a newer in-flight load.
    if (modelLoadingPromise === p) modelLoadingPromise = null;
    throw err;
  });

  modelLoadingPromise = p;
  return p;
}

function getAudioCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
    outputNode = media.connect(audioCtx);
  }
  return audioCtx;
}

// Yield a real task (not a microtask) so runtime messages (pause, stop, seek)
// and the scheduler loop get the thread between syntheses. Single-threaded
// wasm inference otherwise starves the document for the whole lookahead.
function yieldTask() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  return new Promise((r) => setTimeout(r, 0));
}

function queueSynth(fn) {
  const run = synthChain.then(yieldTask).then(fn);
  synthChain = run.catch(() => {});
  return run;
}

function cacheKey(text, speed, voice) {
  return `${voice || currentVoice}|${speed}|${text}`;
}

/** @param {() => boolean} [stillWanted] checked right before synthesis starts; a
 *  stopped or re-seeked read must not keep the (single-threaded) engine busy. */
async function synthesizeToBuffer(text, speed = 1.0, voice, stillWanted) {
  const rate = Math.max(0.5, Math.min(3.0, speed || 1));
  const v = voice || currentVoice;
  const key = cacheKey(text, rate, v);
  if (synthCache.has(key)) return synthCache.get(key);

  const audio = await queueSynth(async () => {
    if (stillWanted && !stillWanted()) throw new Error('superseded');
    const t0 = performance.now();
    const out = await tts.generate(text, { voice: v, speed: rate });
    synthStats.push({ ms: Math.round(performance.now() - t0), chars: text.length });
    if (synthStats.length > 20) synthStats.shift();
    return out;
  });
  // kokoro-js returns a transformers.js RawAudio: samples live in .audio (not .data).
  const samples = audio.audio || audio.data;
  if (!samples || !samples.length) throw new Error('Kokoro returned no audio');
  const sr = audio.sampling_rate || 24000;
  const ctx = getAudioCtx();
  const buf = ctx.createBuffer(1, samples.length, sr);
  buf.getChannelData(0).set(samples);
  const entry = { buf, sr, duration: samples.length / sr };
  synthCache.set(key, entry);
  if (synthCache.size > 48) {
    const first = synthCache.keys().next().value;
    synthCache.delete(first);
  }
  return entry;
}

// ── Gapless session ─────────────────────────────────────────────────────────

/** Wall-clock ms (Date.now() scale) at which AudioContext time `when` is heard. */
function wallClockAt(ctx, when) {
  try {
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
      return performance.timeOrigin + ts.performanceTime + (when - ts.contextTime) * 1000;
    }
  } catch (_) {}
  return Date.now() + (when - ctx.currentTime) * 1000;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isLive(sess) {
  return session === sess && !sess.stopped;
}

function entryFor(sess, i) {
  if (!sess.pending.has(i)) {
    const s = sess.sentences[i];
    sess.pending.set(i, synthesizeToBuffer(s.text, sess.speed, sess.voice, () => isLive(sess)));
  }
  return sess.pending.get(i);
}

function prefetch(sess, from) {
  for (let i = from; i < Math.min(sess.sentences.length, from + LOOKAHEAD); i++) {
    entryFor(sess, i).catch(() => {});
  }
}

function chunkMessage(sess, item) {
  return {
    action: 'kokoro_chunk',
    tabId: sess.tabId,
    session: sess.clientSession,
    index: item.index,
    startWordIdx: sess.sentences[item.index].startWordIdx,
    startedAt: wallClockAt(audioCtx, item.when),
    duration: item.duration,
  };
}

/** Number of scheduled chunks that have not finished playing. */
function pendingAudio(sess) {
  const now = audioCtx.currentTime;
  sess.scheduled = sess.scheduled.filter((x) => x.when + x.duration > now - 0.05);
  return sess.scheduled.length;
}

async function runSession(sess) {
  if (!tts) {
    try {
      await loadModel(sess.tabId, sess.voice, sess.device);
    } catch (err) {
      if (isLive(sess)) {
        send({ action: 'kokoro_error', error: err.message, tabId: sess.tabId });
        endSession(sess);
      }
      return;
    }
    if (!isLive(sess)) return;
  }

  const ctx = getAudioCtx();
  if (ctx.state === 'suspended' && !sess.paused) await ctx.resume().catch(() => {});
  let nextWhen = 0;
  let playedAny = false;

  for (let i = 0; i < sess.sentences.length; i++) {
    if (!isLive(sess)) return;
    prefetch(sess, i);
    let entry;
    try {
      entry = await entryFor(sess, i);
    } catch (err) {
      if (!isLive(sess)) return;
      send({ action: 'kokoro_error', error: err.message, tabId: sess.tabId });
      endSession(sess);
      return;
    }
    sess.pending.delete(i);
    if (!isLive(sess)) return;
    // Backpressure: keep at most one chunk queued behind the one playing.
    while (pendingAudio(sess) >= 2) {
      await sleep(80);
      if (!isLive(sess)) return;
    }
    const when = Math.max(nextWhen, ctx.currentTime + SCHEDULE_LEAD_SEC);
    const src = ctx.createBufferSource();
    src.buffer = entry.buf;
    src.connect(outputNode || ctx.destination);
    src.start(when);
    const item = { index: i, src, when, duration: entry.duration };
    sess.scheduled.push(item);
    nextWhen = when + entry.duration;
    playedAny = true;
    // Sent ahead of time: the content script applies it at `startedAt`.
    if (!sess.paused) send(chunkMessage(sess, item));
  }

  // Let the tail play out (the clock does not advance while paused).
  while (isLive(sess) && audioCtx.currentTime < nextWhen) await sleep(100);
  if (!isLive(sess)) return;
  if (playedAny) {
    send({ action: 'kokoro_end', tabId: sess.tabId, session: sess.clientSession });
  } else {
    send({ action: 'kokoro_error', error: 'Nothing to read — reload the page or switch to Classic voice', tabId: sess.tabId });
  }
  endSession(sess);
}

function stopSources(sess) {
  for (const item of sess.scheduled) {
    try { item.src.stop(); } catch (_) {}
    try { item.src.disconnect(); } catch (_) {}
  }
  sess.scheduled = [];
}

function endSession(sess) {
  if (!sess) return;
  sess.stopped = true;
  stopSources(sess);
  if (session === sess) {
    session = null;
    media.setState('none');
  }
}

function stopPlayback() {
  if (session) endSession(session);
  // A paused session leaves the context suspended; wake it for the next read.
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}

function startSession(msg) {
  stopPlayback();
  if (msg.voice) currentVoice = msg.voice;
  const sess = {
    id: ++sessionCounter,
    clientSession: msg.session,
    tabId: msg.tabId,
    sentences: msg.sentences || [],
    speed: msg.speed || 1.0,
    voice: msg.voice || currentVoice,
    device: msg.device,
    scheduled: [],
    pending: new Map(),
    paused: false,
    stopped: false,
  };
  session = sess;
  media.setMetadata({ title: msg.title || 'Vox Reader', artist: 'Vox Reader', album: msg.site || '' });
  media.setState('playing');
  runSession(sess);
}

function pausePlayback() {
  if (!session || session.paused) return;
  session.paused = true;
  media.setState('paused');
  if (audioCtx) audioCtx.suspend().catch(() => {});
}

async function resumePlayback(tabId) {
  const sess = session;
  if (!sess || !sess.paused) {
    // Offscreen doc may have been recycled during a long pause — let the tab restart.
    if (!sess) send({ action: 'kokoro_resume_failed', tabId });
    return;
  }
  if (audioCtx) await audioCtx.resume().catch(() => {});
  if (!isLive(sess)) return;
  sess.paused = false;
  media.setState('playing');
  pendingAudio(sess);
  for (const item of sess.scheduled) send(chunkMessage(sess, item));
}

async function exportAudio(sentences, tabId, speed, voice, exportGen, filename, format = 'wav', mp3Bitrate = 128) {
  if (!tts) {
    await loadModel(tabId, voice);
  }
  if (exportGen !== exportGeneration) return;

  exportInProgress = true;
  const sr = 24000;
  const chunks = [];
  let totalLen = 0;

  try {
    for (let i = 0; i < sentences.length; i++) {
      if (exportGen !== exportGeneration) {
        send({ action: 'kokoro_export_error', tabId, error: 'Export cancelled' });
        return;
      }

      send({
        action: 'kokoro_export_progress',
        tabId,
        pct: sentences.length ? Math.round((i / sentences.length) * 100) : 0,
      });

      const entry = await synthesizeToBuffer(sentences[i].text, speed, voice);
      if (exportGen !== exportGeneration) {
        send({ action: 'kokoro_export_error', tabId, error: 'Export cancelled' });
        return;
      }

      const samples = entry.buf.getChannelData(0);
      chunks.push(samples);
      totalLen += samples.length;
    }

    const merged = new Float32Array(totalLen);
    let pos = 0;
    for (const chunk of chunks) {
      merged.set(chunk, pos);
      pos += chunk.length;
    }

    const useMp3 = format === 'mp3';
    const kbps = [96, 128, 192].includes(mp3Bitrate) ? mp3Bitrate : 128;
    const audioBuffer = useMp3 ? encodeMp3(merged, sr, kbps) : encodeWav(merged, sr);
    const ext = useMp3 ? 'mp3' : 'wav';
    send({
      action: 'kokoro_export_ready',
      tabId,
      audioBase64: bytesToBase64(audioBuffer),
      mimeType: useMp3 ? 'audio/mpeg' : 'audio/wav',
      filename: filename || `vox-reader-export.${ext}`,
    });
  } catch (err) {
    if (exportGen === exportGeneration) {
      send({ action: 'kokoro_export_error', error: err.message, tabId });
    }
  } finally {
    if (exportGen === exportGeneration) exportInProgress = false;
  }
}

chrome.runtime.sendMessage({ action: 'offscreen_ready' }).catch(() => {});

// Lifeline to the service worker: if the browser closes this document, the
// port disconnects and the SW tells the reading tab to resume elsewhere.
function connectLifeline() {
  try {
    const port = chrome.runtime.connect({ name: 'vox-offscreen' });
    port.onDisconnect.addListener(() => setTimeout(connectLifeline, 500)); // SW restarted
  } catch (_) { setTimeout(connectLifeline, 2000); }
}
connectLifeline();

/** A control message for an older read (it raced a newer kokoro_speak). */
function isStale(msg) {
  return msg.session != null && session && session.clientSession != null && msg.session < session.clientSession;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if ((msg.action === 'kokoro_stop' || msg.action === 'kokoro_pause' || msg.action === 'kokoro_resume') && isStale(msg)) return;

  if (msg.action === 'kokoro_load') {
    const tabId = msg.tabId;
    if (msg.voice) currentVoice = msg.voice;
    if (tabId) loadWaiters.add(tabId);
    const loading = loadModel(tabId, msg.voice, msg.device);
    // loadModel bumps loadGeneration synchronously when it starts a download, so
    // read it afterwards; a later bump means this load was cancelled.
    const loadGen = loadGeneration;
    loading
      .then(() => {
        if (tabId) loadWaiters.delete(tabId);
        if (loadGen !== loadGeneration && !tts) return;
        send({ action: 'kokoro_ready', tabId, backend: activeBackend });
      })
      .catch((err) => {
        if (tabId) loadWaiters.delete(tabId);
        // Model may have completed despite a stale generation (e.g. another
        // tab cancelled) — report ready rather than leaving this tab loading.
        if (tts) {
          send({ action: 'kokoro_ready', tabId });
          return;
        }
        if (loadGen !== loadGeneration || err.message === 'Download cancelled') {
          send({ action: 'kokoro_load_cancelled', tabId });
          return;
        }
        send({ action: 'kokoro_error', error: err.message, tabId });
      });
    return;
  }

  if (msg.action === 'kokoro_load_cancel') {
    loadGeneration++;
    modelLoadingPromise = null;
    if (msg.tabId) loadWaiters.delete(msg.tabId);
    // Model may have finished downloading while voice files were still loading —
    // treat as ready so the user isn't stuck with a broken AI voice state.
    if (tts) {
      send({ action: 'kokoro_ready', tabId: msg.tabId });
    } else {
      send({ action: 'kokoro_load_cancelled', tabId: msg.tabId });
    }
    return;
  }

  if (msg.action === 'kokoro_warm_voice') {
    if (msg.voice) currentVoice = msg.voice;
    warmVoice(currentVoice).catch(() => {});
    return;
  }

  if (msg.action === 'kokoro_speak') {
    if (exportInProgress) {
      send({ action: 'kokoro_error', error: 'Export in progress — try again shortly', tabId: msg.tabId });
      return;
    }
    startSession(msg);
    return;
  }

  if (msg.action === 'kokoro_pause') {
    pausePlayback();
    return;
  }

  if (msg.action === 'kokoro_resume') {
    resumePlayback(msg.tabId);
    return;
  }

  if (msg.action === 'kokoro_stop') {
    stopPlayback();
    return;
  }

  if (msg.action === 'kokoro_export_cancel') {
    exportGeneration++;
    return;
  }

  if (msg.action === 'kokoro_export') {
    stopPlayback();
    const exportGen = ++exportGeneration;
    if (msg.voice) currentVoice = msg.voice;
    exportAudio(msg.sentences, msg.tabId, msg.speed || 1.0, msg.voice, exportGen, msg.filename, msg.format || 'wav', msg.mp3Bitrate || 128)
      .catch((err) => send({ action: 'kokoro_export_error', error: err.message, tabId: msg.tabId }));
    return;
  }

  if (msg.action === 'kokoro_debug_caches') {
    // Diagnostics: where transformers.js / kokoro-js cached the model (this origin's Cache API).
    (async () => {
      const out = { origin: location.origin, caches: {} };
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        const entries = [];
        for (const req of await cache.keys()) {
          const res = await cache.match(req);
          const len = Number(res?.headers.get('content-length')) || (await res.clone().arrayBuffer()).byteLength;
          entries.push({ url: req.url, bytes: len });
        }
        out.caches[name] = entries;
      }
      if (navigator.storage?.estimate) out.estimate = await navigator.storage.estimate();
      send({ action: 'kokoro_debug_caches_result', result: out });
    })().catch((err) => send({ action: 'kokoro_debug_caches_result', error: String(err) }));
    return;
  }

  if (msg.action === 'kokoro_debug_state') {
    // Test hook: report scheduling state (used by the Brave harness).
    const s = session;
    send({
      action: 'kokoro_debug_state_result',
      tabId: msg.tabId,
      state: {
        ctxState: audioCtx?.state || 'none',
        ctxTime: audioCtx?.currentTime || 0,
        session: s ? { paused: s.paused, scheduled: s.scheduled.map((x) => ({ i: x.index, when: x.when, d: x.duration })) } : null,
        media: media.describe(),
        backend: activeBackend,
        devicePref,
        backendErrors,
        webgpuAvailable: !!navigator.gpu,
        crossOriginIsolated: self.crossOriginIsolated === true,
        threads: navigator.hardwareConcurrency,
        synth: synthStats.slice(-8),
      },
    });
  }
});
