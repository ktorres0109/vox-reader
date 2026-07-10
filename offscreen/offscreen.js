// Vox Reader — Kokoro 82M neural TTS (offscreen document)
// Uses kokoro-js for multi-voice synthesis (Bella, Sarah, etc.)

import { KokoroTTS } from '../vendor/kokoro.web.js';
import { encodeWav, bytesToBase64 } from './wav.js';
import { encodeMp3 } from './mp3.js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let tts = null;
let audioCtx = null;
let currentSource = null;
let isPlaying = false;
let generation = 0;
let exportGeneration = 0;
let exportInProgress = false;
let modelLoadingPromise = null;
let currentVoice = 'af_bella';

/** @type {{ sentences: object[], tabId: number, gen: number, speed: number, voice: string, sentenceIndex: number, offsetSec: number, paused: boolean, chunkStartedAt?: number, chunkDuration?: number } | null} */
let loopState = null;
const synthCache = new Map();

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

async function warmVoice(voice) {
  if (!tts) return;
  const v = voice || currentVoice;
  try {
    await tts.generate('Ready.', { voice: v, speed: 1 });
  } catch (_) { /* voice file fetch may fail offline — speak will retry */ }
}

async function loadModel(tabId, voice) {
  if (voice) currentVoice = voice;
  if (tts) {
    await warmVoice(currentVoice);
    return;
  }
  if (modelLoadingPromise) return modelLoadingPromise;

  modelLoadingPromise = KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (data) => reportProgress(tabId, data),
  }).then(async (model) => {
    tts = model;
    modelLoadingPromise = null;
    await warmVoice(currentVoice);
  }).catch((err) => {
    modelLoadingPromise = null;
    throw err;
  });

  return modelLoadingPromise;
}

function getAudioCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext();
  }
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

function cacheKey(text, speed, voice) {
  return `${voice || currentVoice}|${speed}|${text}`;
}

async function synthesizeToBuffer(text, speed = 1.0, voice) {
  const rate = Math.max(0.5, Math.min(3.0, speed || 1));
  const v = voice || currentVoice;
  const key = cacheKey(text, rate, v);
  if (synthCache.has(key)) return synthCache.get(key);

  const audio = await tts.generate(text, { voice: v, speed: rate });
  const samples = audio.data;
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

function playBuffer(entry, offsetSec = 0) {
  stopCurrentAudio();
  const ctx = getAudioCtx();
  const src = ctx.createBufferSource();
  src.buffer = entry.buf;
  src.connect(ctx.destination);
  currentSource = src;
  const safeOffset = Math.max(0, Math.min(offsetSec, Math.max(0, entry.duration - 0.01)));
  const startedAt = Date.now();
  const duration = Math.max(0, entry.duration - safeOffset);
  src.start(0, safeOffset);
  return { startedAt, duration, offsetSec: safeOffset };
}

function waitForPlayback(durationSec) {
  return new Promise((resolve, reject) => {
    if (!currentSource) {
      resolve();
      return;
    }
    currentSource.onended = resolve;
    currentSource.onerror = reject;
    setTimeout(resolve, (durationSec + 1) * 1000);
  });
}

function clearLoopState() {
  loopState = null;
}

async function runSentenceLoop(sentences, tabId, gen, speed = 1.0, voice, startIndex = 0, startOffset = 0) {
  if (voice) currentVoice = voice;
  loopState = {
    sentences,
    tabId,
    gen,
    speed: speed || 1.0,
    voice: voice || currentVoice,
    sentenceIndex: startIndex,
    offsetSec: startOffset,
    paused: false,
  };
  isPlaying = true;

  if (!tts) {
    try {
      await loadModel(tabId, currentVoice);
    } catch (err) {
      if (generation === gen) {
        send({ action: 'kokoro_error', error: err.message, tabId });
        isPlaying = false;
        clearLoopState();
      }
      return;
    }
    if (!isPlaying || generation !== gen || !loopState) return;
  }

  for (let i = startIndex; i < sentences.length; i++) {
    if (!isPlaying || generation !== gen || !loopState) break;
    if (loopState.paused) return;

    loopState.sentenceIndex = i;
    const sentence = sentences[i];
    const offset = i === startIndex ? startOffset : 0;
    loopState.offsetSec = offset;

    try {
      const entry = await synthesizeToBuffer(sentence.text, speed, currentVoice);
      if (!isPlaying || generation !== gen || !loopState || loopState.paused) break;

      const played = playBuffer(entry, offset);
      loopState.chunkStartedAt = played.startedAt;
      loopState.chunkDuration = played.duration + offset;

      send({
        action: 'kokoro_chunk',
        startWordIdx: sentence.startWordIdx,
        startedAt: played.startedAt,
        duration: played.duration,
        tabId,
      });

      await waitForPlayback(played.duration);
      loopState.offsetSec = 0;
    } catch (err) {
      if (!isPlaying || generation !== gen) break;
      send({ action: 'kokoro_error', error: err.message, tabId });
      isPlaying = false;
      clearLoopState();
      return;
    }
  }

  if (isPlaying && generation === gen && loopState && !loopState.paused) {
    send({ action: 'kokoro_end', tabId });
  }
  if (generation === gen) {
    isPlaying = false;
    currentSource = null;
    clearLoopState();
  }
}

function pausePlayback() {
  if (!loopState || !isPlaying) return;
  const elapsed = loopState.chunkStartedAt
    ? (Date.now() - loopState.chunkStartedAt) / 1000
    : 0;
  const base = loopState.offsetSec || 0;
  loopState.offsetSec = Math.min(base + elapsed, loopState.chunkDuration || base + elapsed);
  loopState.paused = true;
  isPlaying = false;
  stopCurrentAudio();
}

function resumePlayback() {
  if (!loopState || !loopState.paused) return;
  loopState.paused = false;
  const { sentences, tabId, gen, speed, voice, sentenceIndex, offsetSec } = loopState;
  isPlaying = true;
  runSentenceLoop(sentences, tabId, gen, speed, voice, sentenceIndex, offsetSec);
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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;

  if (msg.action === 'kokoro_load') {
    const tabId = msg.tabId;
    if (msg.voice) currentVoice = msg.voice;
    loadModel(tabId, msg.voice)
      .then(() => send({ action: 'kokoro_ready', tabId }))
      .catch((err) => send({ action: 'kokoro_error', error: err.message, tabId }));
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
    if (msg.voice) currentVoice = msg.voice;
    isPlaying = false;
    stopCurrentAudio();
    clearLoopState();
    const thisGen = ++generation;
    setTimeout(() => {
      runSentenceLoop(msg.sentences, msg.tabId, thisGen, msg.speed || 1.0, msg.voice);
    }, 30);
    return;
  }

  if (msg.action === 'kokoro_pause') {
    pausePlayback();
    return;
  }

  if (msg.action === 'kokoro_resume') {
    resumePlayback();
    return;
  }

  if (msg.action === 'kokoro_stop') {
    isPlaying = false;
    generation++;
    stopCurrentAudio();
    clearLoopState();
    return;
  }

  if (msg.action === 'kokoro_export_cancel') {
    exportGeneration++;
    return;
  }

  if (msg.action === 'kokoro_export') {
    isPlaying = false;
    generation++;
    stopCurrentAudio();
    clearLoopState();
    const exportGen = ++exportGeneration;
    if (msg.voice) currentVoice = msg.voice;
    exportAudio(msg.sentences, msg.tabId, msg.speed || 1.0, msg.voice, exportGen, msg.filename, msg.format || 'wav', msg.mp3Bitrate || 128)
      .catch((err) => send({ action: 'kokoro_export_error', error: err.message, tabId: msg.tabId }));
    return;
  }
});
