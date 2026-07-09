// Vox Reader — Kokoro 82M neural TTS (offscreen document)
// Uses kokoro-js for multi-voice synthesis (Bella, Sarah, etc.)

import { KokoroTTS } from '../vendor/kokoro.web.js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let tts = null;
let audioCtx = null;
let currentSource = null;
let isPlaying = false;
let generation = 0;
let modelLoadingPromise = null;
let currentVoice = 'af_bella'; // Bella — default Kokoro voice

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

async function synthesizeAndPlay(text, speed = 1.0, voice) {
  if (!tts) throw new Error('Model not loaded');
  if (!isPlaying) return null;
  stopCurrentAudio();

  const audio = await tts.generate(text, {
    voice: voice || currentVoice,
    speed: Math.max(0.5, Math.min(3.0, speed || 1)),
  });
  if (!isPlaying) return null;

  const samples = audio.data;
  const sr = audio.sampling_rate || 24000;
  const ctx = getAudioCtx();
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

async function runSentenceLoop(sentences, tabId, gen, speed = 1.0, voice) {
  isPlaying = true;
  if (voice) currentVoice = voice;

  if (!tts) {
    try {
      await loadModel(tabId, currentVoice);
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
      const played = await synthesizeAndPlay(sentence.text, speed, currentVoice);
      if (!played || !isPlaying || generation !== gen) break;
      const { startedAt, duration } = played;

      send({
        action: 'kokoro_chunk',
        startWordIdx: sentence.startWordIdx,
        startedAt,
        duration,
        tabId,
      });

      await new Promise((resolve, reject) => {
        currentSource.onended = resolve;
        currentSource.onerror = reject;
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
    if (msg.voice) currentVoice = msg.voice;
    isPlaying = false;
    stopCurrentAudio();
    const thisGen = ++generation;
    setTimeout(() => {
      runSentenceLoop(msg.sentences, msg.tabId, thisGen, msg.speed || 1.0, msg.voice);
    }, 30);
    return;
  }

  if (msg.action === 'kokoro_stop') {
    isPlaying = false;
    generation++;
    stopCurrentAudio();
    return;
  }
});
