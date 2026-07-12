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
let loadGeneration = 0;
let modelLoadingPromise = null;
let currentVoice = 'af_bella';

/** @type {{ sentences: object[], tabId: number, gen: number, playbackId: number, speed: number, voice: string, sentenceIndex: number, offsetSec: number, paused: boolean, chunkStartedAt?: number, chunkDuration?: number } | null} */
let loopState = null;
let loopEpoch = 0; // increments on every runSentenceLoop start so superseded loops exit
const synthCache = new Map();
const loadWaiters = new Set(); // tabIds waiting for a kokoro_load to finish

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
    await tts.generate('Ready.', { voice: v, speed: 1 });
  } catch (_) { /* voice file fetch may fail offline — speak will retry */ }
}

async function loadModel(tabId, voice) {
  if (voice) currentVoice = voice;
  if (tts) {
    await warmVoice(currentVoice, tabId);
    return;
  }
  if (modelLoadingPromise) return modelLoadingPromise;

  const thisGen = ++loadGeneration;
  const p = KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (data) => {
      if (thisGen !== loadGeneration) return;
      if (loadWaiters.size) {
        for (const tid of loadWaiters) reportProgress(tid, data);
      } else {
        reportProgress(tabId, data);
      }
    },
  }).then(async (model) => {
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
    const source = currentSource;
    if (!source) {
      resolve();
      return;
    }
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      source.onended = null;
      source.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    source.onended = () => finish();
    source.onerror = (error) => finish(error);
    const timer = setTimeout(() => finish(), (durationSec + 1) * 1000);
  });
}

function clearLoopState() {
  loopState = null;
}

async function runSentenceLoop(sentences, tabId, gen, playbackId, speed = 1.0, voice, startIndex = 0, startOffset = 0) {
  if (voice) currentVoice = voice;
  const epoch = ++loopEpoch;
  loopState = {
    sentences,
    tabId,
    gen,
    playbackId,
    speed: speed || 1.0,
    voice: voice || currentVoice,
    sentenceIndex: startIndex,
    offsetSec: startOffset,
    paused: false,
  };
  isPlaying = true;

  const superseded = () => generation !== gen || epoch !== loopEpoch;

  if (!tts) {
    try {
      await loadModel(tabId, currentVoice);
    } catch (err) {
      if (!superseded()) {
        send({ action: 'kokoro_error', error: err.message, tabId, playbackId });
        isPlaying = false;
        clearLoopState();
      }
      return;
    }
    if (!isPlaying || superseded() || !loopState) return;
  }

  let playedAny = false;
  for (let i = startIndex; i < sentences.length; i++) {
    if (superseded() || !loopState) return;
    if (!isPlaying) break;
    // Paused before this sentence started — keep loopState for resume
    if (loopState.paused) return;

    loopState.sentenceIndex = i;
    const sentence = sentences[i];
    const offset = i === startIndex ? startOffset : 0;
    loopState.offsetSec = offset;
    loopState.chunkStartedAt = null;

    try {
      const entry = await synthesizeToBuffer(sentence.text, speed, currentVoice);
      if (superseded() || !loopState) return;
      // Paused while this sentence was synthesizing — resume replays it (cache hit)
      if (loopState.paused) return;
      if (!isPlaying) break;

      const played = playBuffer(entry, offset);
      loopState.chunkStartedAt = played.startedAt;
      loopState.chunkDuration = played.duration + offset;
      playedAny = true;

      send({
        action: 'kokoro_chunk',
        startWordIdx: sentence.startWordIdx,
        startedAt: played.startedAt,
        duration: played.duration,
        tabId,
        playbackId,
      });

      await waitForPlayback(played.duration);
      if (superseded() || !loopState) return;
      // Paused mid-chunk — pausePlayback already saved offsetSec; keep it
      if (loopState.paused) return;
      loopState.offsetSec = 0;
      loopState.chunkStartedAt = null;
    } catch (err) {
      if (superseded() || !isPlaying) break;
      send({ action: 'kokoro_error', error: err.message, tabId, playbackId });
      isPlaying = false;
      clearLoopState();
      return;
    }
  }

  if (superseded()) return;

  if (isPlaying && loopState && !loopState.paused) {
    if (playedAny) {
      send({ action: 'kokoro_end', tabId, playbackId });
    } else {
      send({
        action: 'kokoro_error',
        error: 'Nothing to read — reload the page or switch to Classic voice',
        tabId,
        playbackId,
      });
    }
  }
  if (!(loopState && loopState.paused)) {
    isPlaying = false;
    currentSource = null;
    clearLoopState();
  }
}

function pausePlayback() {
  if (!loopState || !isPlaying) return;
  // Only add elapsed time when a chunk is actually playing; while a sentence is
  // still synthesizing there is no audio yet, so the saved offset stays as-is.
  if (currentSource && loopState.chunkStartedAt) {
    const elapsed = (Date.now() - loopState.chunkStartedAt) / 1000;
    const base = loopState.offsetSec || 0;
    loopState.offsetSec = Math.min(base + elapsed, loopState.chunkDuration || base + elapsed);
  }
  loopState.paused = true;
  isPlaying = false;
  stopCurrentAudio();
}

function resumePlayback() {
  if (!loopState || !loopState.paused) return;
  loopState.paused = false;
  const { sentences, tabId, gen, playbackId, speed, voice, sentenceIndex, offsetSec } = loopState;
  isPlaying = true;
  runSentenceLoop(sentences, tabId, gen, playbackId, speed, voice, sentenceIndex, offsetSec);
}

async function exportAudio(sentences, tabId, speed, voice, exportGen, filename, format = 'wav', mp3Bitrate = 128) {
  const sr = 24000;
  const chunks = [];
  let totalLen = 0;

  try {
    if (!tts) {
      await loadModel(tabId, voice);
    }
    if (exportGen !== exportGeneration) return;

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
    const wavBytes = totalLen * 2 + 44;
    // Chrome extension messages have a finite IPC payload. Keep base64 safely
    // below that limit and tell the user to choose MP3 instead of hanging.
    if (!useMp3 && wavBytes > 24 * 1024 * 1024) {
      throw new Error('WAV export is too large — choose MP3 or export a shorter range');
    }
    const kbps = [96, 128, 192].includes(mp3Bitrate) ? mp3Bitrate : 128;
    const audioBuffer = useMp3 ? encodeMp3(merged, sr, kbps) : encodeWav(merged, sr);
    const ext = useMp3 ? 'mp3' : 'wav';
    await chrome.runtime.sendMessage({
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
    const loadGen = loadGeneration;
    if (msg.voice) currentVoice = msg.voice;
    if (tabId) loadWaiters.add(tabId);
    loadModel(tabId, msg.voice)
      .then(() => {
        const stillWaiting = !tabId || loadWaiters.has(tabId);
        if (tabId) loadWaiters.delete(tabId);
        if (!stillWaiting) return;
        if (loadGen !== loadGeneration && !tts) return;
        send({ action: 'kokoro_ready', tabId });
      })
      .catch((err) => {
        const stillWaiting = !tabId || loadWaiters.has(tabId);
        if (tabId) loadWaiters.delete(tabId);
        if (!stillWaiting) return;
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
    if (msg.tabId) loadWaiters.delete(msg.tabId);
    // Cancelling in one tab must not abort the shared model load for other tabs.
    if (loadWaiters.size > 0) {
      send({ action: 'kokoro_load_cancelled', tabId: msg.tabId });
      return;
    }
    loadGeneration++;
    modelLoadingPromise = null;
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
      send({
        action: 'kokoro_error',
        error: 'Export in progress — try again shortly',
        tabId: msg.tabId,
        playbackId: msg.playbackId,
      });
      return;
    }
    if (msg.voice) currentVoice = msg.voice;
    isPlaying = false;
    stopCurrentAudio();
    clearLoopState();
    const thisGen = ++generation;
    // Start synchronously through the first await so an immediate Pause always
    // finds loopState instead of racing a delayed startup timer.
    runSentenceLoop(
      msg.sentences,
      msg.tabId,
      thisGen,
      msg.playbackId,
      msg.speed || 1.0,
      msg.voice,
    );
    return;
  }

  if (msg.action === 'kokoro_pause') {
    if (loopState && msg.playbackId !== loopState.playbackId) return;
    pausePlayback();
    return;
  }

  if (msg.action === 'kokoro_resume') {
    if (loopState && msg.playbackId !== loopState.playbackId) return;
    resumePlayback();
    return;
  }

  if (msg.action === 'kokoro_stop') {
    if (loopState && msg.playbackId != null && msg.playbackId !== loopState.playbackId) return;
    isPlaying = false;
    generation++;
    stopCurrentAudio();
    clearLoopState();
    return;
  }

  if (msg.action === 'kokoro_export_cancel') {
    exportGeneration++;
    exportInProgress = false;
    return;
  }

  if (msg.action === 'kokoro_export') {
    isPlaying = false;
    generation++;
    stopCurrentAudio();
    clearLoopState();
    const exportGen = ++exportGeneration;
    exportInProgress = true;
    if (msg.voice) currentVoice = msg.voice;
    exportAudio(msg.sentences, msg.tabId, msg.speed || 1.0, msg.voice, exportGen, msg.filename, msg.format || 'wav', msg.mp3Bitrate || 128)
      .catch((err) => send({ action: 'kokoro_export_error', error: err.message, tabId: msg.tabId }));
    return;
  }
});
