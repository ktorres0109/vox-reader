// PCM float32 mono → MP3 via lamejs (loaded as global in offscreen.html)

const MP3_BLOCK = 1152;

function floatToInt16(samples) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm;
}

export function encodeMp3(samples, sampleRate = 24000, kbps = 128) {
  const lamejs = globalThis.lamejs;
  if (!lamejs?.Mp3Encoder) {
    throw new Error('MP3 encoder not loaded — run npm run fetch-deps');
  }

  const encoder = new lamejs.Mp3Encoder(1, sampleRate, kbps);
  const pcm = floatToInt16(samples);
  const parts = [];

  for (let i = 0; i < pcm.length; i += MP3_BLOCK) {
    const chunk = pcm.subarray(i, i + MP3_BLOCK);
    const buf = encoder.encodeBuffer(chunk);
    if (buf.length > 0) parts.push(buf);
  }

  const end = encoder.flush();
  if (end.length > 0) parts.push(end);

  let total = 0;
  for (const part of parts) total += part.length;
  const merged = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    merged.set(part, pos);
    pos += part.length;
  }
  return merged.buffer;
}
