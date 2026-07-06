// Vox Reader — Neural TTS Offscreen Document (Xenova/mms-tts-eng)
// Handles neural speech synthesis + audio playback.
// Runs in a dedicated offscreen page so WASM/AudioContext don't block the extension.

import { pipeline, env } from '../vendor/transformers.min.js';

// Suppress verbose logging
env.logLevel = 'error';

// Point ORT-Web at locally bundled WASM files — no CDN hit at runtime.
// Use string (directory) form: ORT appends filenames to construct full URLs.
// Object form with { mjs, wasm } keys is NOT recognized by ORT and silently falls
// back to the CDN URL baked into transformers.min.js, causing "Failed to fetch".
// numThreads=1: offscreen documents lack COOP/COEP headers required for
// SharedArrayBuffer, so multi-threaded WASM fails; single-threaded always works.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('vendor/');

// Redirect model fetches to locally bundled files — no CDN hit at runtime.
// Run tools/fetch-deps.sh once to populate vendor/models/.
// Note: allowRemoteModels stays true (browser build always uses fetch());
//       overriding remoteHost/remotePathTemplate points it at chrome-extension:// URLs.
env.remoteHost = chrome.runtime.getURL('vendor/models/');
env.remotePathTemplate = '{model}/';
env.useBrowserCache = false;

// ── State ──────────────────────────────────────────────────────────────────
let synthesizer = null;
let audioCtx = null;
let currentSource = null;
let isPlaying = false;
let pendingTabId = null;
let generation = 0; // incremented on every new kokoro_speak; loops check their gen to exit cleanly

// ── Model loading ──────────────────────────────────────────────────────────
let modelLoadingPromise = null;

async function loadModel() {
  if (synthesizer) return;
  // Guard concurrent calls — multiple kokoro_load messages (SW retries) must not
  // each kick off their own pipeline() call; they should all wait on the same one.
  if (modelLoadingPromise) return modelLoadingPromise;
  modelLoadingPromise = pipeline(
    'text-to-speech',
    'Xenova/mms-tts-eng',
    { dtype: 'q8' }
  ).then(p => {
    synthesizer = p;
    modelLoadingPromise = null;
  }).catch(err => {
    modelLoadingPromise = null;
    throw err;
  });
  return modelLoadingPromise;
}

// ── Audio playback ─────────────────────────────────────────────────────────
function getAudioCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext({ sampleRate: 16000 });
  }
  // Browser may suspend AudioContext for power management — resume before use
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function stopCurrentAudio() {
  if (currentSource) {
    try { currentSource.stop(); } catch (_) {}
    currentSource = null;
  }
}

// Synthesize one chunk of text and play it via AudioContext.
// Returns { startedAt, duration } so content script can start its timing ticker.
async function synthesizeAndPlay(text) {
  if (!synthesizer) throw new Error('Model not loaded');
  const ctx = getAudioCtx();
  stopCurrentAudio();

  // mms-tts-eng — single speaker, no voice/speed params
  const out = await synthesizer(text);

  const samples = out.audio;                    // Float32Array, 16000Hz mono
  const sr = out.sampling_rate || 16000;
  const buf = ctx.createBuffer(1, samples.length, sr);
  buf.getChannelData(0).set(samples);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  currentSource = src;

  const startedAt = Date.now();
  src.start();

  return { startedAt, duration: samples.length / sr };
}

// ── Sentence-streaming synthesis loop ──────────────────────────────────────
// Synthesizes sentences one at a time, plays each immediately when ready.
// gen: snapshot of `generation` at call time. A new kokoro_speak increments
// `generation`, so any in-flight loop sees gen !== generation and exits —
// even if it's blocked inside `await synthesizer(text)` when the cancel arrives.
async function runSentenceLoop(sentences, tabId, gen) {
  isPlaying = true;

  // Speak may arrive before (or instead of) an explicit kokoro_load — e.g.
  // the SW was restarted and the cached-flag UI skipped the load step. Load
  // on demand rather than dying with "Model not loaded".
  if (!synthesizer) {
    try {
      await loadModel();
    } catch (err) {
      if (generation === gen) {
        send({ action: 'kokoro_error', error: err.message, tabId });
        isPlaying = false;
      }
      return;
    }
    if (!isPlaying || generation !== gen) return;
  }

  for (let i = 0; i < sentences.length; i++) {
    if (!isPlaying || generation !== gen) break;

    const sentence = sentences[i];

    try {
      const { startedAt, duration } = await synthesizeAndPlay(sentence.text);
      if (!isPlaying || generation !== gen) break;

      // Tell content script which sentence just started and when,
      // so it can resume the word-highlight ticker from the right word.
      send({ action: 'kokoro_chunk', startWordIdx: sentence.startWordIdx, startedAt, duration, tabId });

      // Wait for audio to finish before playing next sentence
      await new Promise((resolve, reject) => {
        currentSource.onended = resolve;
        currentSource.onerror = reject;
        // Safety timeout in case onended doesn't fire
        setTimeout(resolve, (duration + 1) * 1000);
      });

    } catch (err) {
      if (!isPlaying || generation !== gen) break;
      send({ action: 'kokoro_error', error: err.message, tabId });
      isPlaying = false;
      return;
    }
  }

  if (isPlaying && generation === gen) {
    send({ action: 'kokoro_end', tabId });
  }
  if (generation === gen) {
    isPlaying = false;
    currentSource = null;
  }
}

// ── Message helper ─────────────────────────────────────────────────────────
function send(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// ── Message listener ───────────────────────────────────────────────────────
// Signal SW that we're ready to receive messages. SW may have buffered a
// pending action while waiting for this document to finish loading.
chrome.runtime.sendMessage({ action: 'offscreen_ready' }).catch(() => {});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;

  if (msg.action === 'kokoro_load') {
    const tabId = msg.tabId;  // capture now — pendingTabId may be overwritten before promise resolves
    pendingTabId = tabId;
    loadModel()
      .then(() => send({ action: 'kokoro_ready', tabId }))
      .catch(err => send({ action: 'kokoro_error', error: err.message, tabId }));
    return;
  }

  if (msg.action === 'kokoro_speak') {
    pendingTabId = msg.tabId;
    isPlaying = false;
    stopCurrentAudio();
    const thisGen = ++generation;
    // Small delay lets any in-progress synthesizer() call finish and see the stale gen
    setTimeout(() => {
      runSentenceLoop(msg.sentences, msg.tabId, thisGen);
    }, 30);
    return;
  }

  if (msg.action === 'kokoro_stop') {
    isPlaying = false;
    stopCurrentAudio();
    return;
  }
});
