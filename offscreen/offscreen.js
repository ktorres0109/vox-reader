// Vox Reader — Kokoro TTS Offscreen Document
// Handles neural speech synthesis + audio playback.
// Runs in a dedicated offscreen page so WASM/AudioContext don't block the extension.

import { pipeline, env } from '../vendor/transformers.min.js';

// transformers.js v3 auto-configures wasmPaths to its own CDN and sets numThreads=1
// when crossOriginIsolated is false (which it is in offscreen docs without COOP headers).
// Do NOT override wasmPaths — transformers.js already picks the correct version.

// Suppress verbose logging
env.logging = false;

// ── State ──────────────────────────────────────────────────────────────────
let synthesizer = null;
let audioCtx = null;
let currentSource = null;
let isPlaying = false;
let pendingTabId = null;

// ── Model loading ──────────────────────────────────────────────────────────
async function loadModel(onProgress) {
  if (synthesizer) return;
  synthesizer = await pipeline(
    'text-to-speech',
    'onnx-community/Kokoro-82M-v1.0',
    {
      dtype: 'q8',                    // quantized — ~83MB vs ~330MB fp32
      device: 'wasm',
      progress_callback: onProgress,
    }
  );
}

// ── Audio playback ─────────────────────────────────────────────────────────
function getAudioCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext({ sampleRate: 24000 });
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
async function synthesizeAndPlay(text, voice, speed) {
  if (!synthesizer) throw new Error('Model not loaded');
  const ctx = getAudioCtx();
  stopCurrentAudio();

  // Kokoro pipeline — voice param is the speaker ID string (e.g. 'af_bella')
  const out = await synthesizer(text, {
    voice: voice || 'af_bella',
    speed: speed || 1.0,
  });

  const samples = out.audio;                    // Float32Array, 24kHz mono
  const sr = out.sampling_rate || 24000;
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
// Pipelines: while sentence N plays, sentence N+1 is being synthesized.
async function runSentenceLoop(sentences, voice, speed, tabId) {
  isPlaying = true;

  for (let i = 0; i < sentences.length; i++) {
    if (!isPlaying) break;

    const sentence = sentences[i];

    try {
      const { startedAt, duration } = await synthesizeAndPlay(sentence.text, voice, speed);
      if (!isPlaying) break;

      // Tell content script which sentence just started and when,
      // so it can resume the word-highlight ticker from the right word.
      send({ action: 'kokoro_chunk', startWordIdx: sentence.startWordIdx, startedAt, tabId });

      // Wait for audio to finish before playing next sentence
      await new Promise((resolve, reject) => {
        currentSource.onended = resolve;
        currentSource.onerror = reject;
        // Safety timeout in case onended doesn't fire
        setTimeout(resolve, (duration + 1) * 1000);
      });

    } catch (err) {
      if (!isPlaying) break;
      send({ action: 'kokoro_error', error: err.message, tabId });
      isPlaying = false;
      return;
    }
  }

  if (isPlaying) {
    send({ action: 'kokoro_end', tabId });
  }
  isPlaying = false;
  currentSource = null;
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
    pendingTabId = msg.tabId;
    loadModel((progress) => {
      send({
        action: 'kokoro_progress',
        status: progress.status,
        file: progress.file || '',
        loaded: progress.loaded || 0,
        total: progress.total || 0,
        tabId: pendingTabId,
      });
    })
    .then(() => send({ action: 'kokoro_ready', tabId: pendingTabId }))
    .catch(err => send({ action: 'kokoro_error', error: err.message, tabId: pendingTabId }));
    return;
  }

  if (msg.action === 'kokoro_speak') {
    pendingTabId = msg.tabId;
    isPlaying = false; // cancel any in-progress loop
    stopCurrentAudio();
    // Small delay to let previous loop detect isPlaying = false
    setTimeout(() => {
      runSentenceLoop(msg.sentences, msg.voice, msg.speed, msg.tabId);
    }, 30);
    return;
  }

  if (msg.action === 'kokoro_stop') {
    isPlaying = false;
    stopCurrentAudio();
    return;
  }
});
