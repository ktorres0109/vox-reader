// Test-only content script: replaces speechSynthesis in the extension's
// isolated world so "Classic voice" code paths never reach macOS TTS.
// (--mute-audio silences WebAudio/Kokoro but NOT OS speech synthesis.)
// The Brave harness prepends this to the copied manifest; it is never shipped.
(() => {
  const voices = [{ name: 'Mock Voice', lang: 'en-US', default: true, localService: true, voiceURI: 'mock' }];
  let current = null;
  let timer = null;
  const fake = {
    speaking: false, paused: false, pending: false, onvoiceschanged: null,
    getVoices: () => voices,
    speak(u) {
      fake.cancel();
      current = u;
      fake.speaking = true;
      const words = String(u.text || '').split(/\s+/).filter(Boolean);
      let i = 0;
      let charIndex = 0;
      setTimeout(() => { if (current === u) u.onstart?.({}); }, 0);
      timer = setInterval(() => {
        if (fake.paused || current !== u) return;
        if (i >= words.length) {
          clearInterval(timer); timer = null;
          fake.speaking = false; current = null;
          u.onend?.({});
          return;
        }
        u.onboundary?.({ name: 'word', charIndex });
        charIndex += words[i].length + 1;
        i++;
      }, 150 / (u.rate || 1));
    },
    cancel() {
      if (timer) { clearInterval(timer); timer = null; }
      if (current) {
        const u = current;
        current = null;
        fake.speaking = false;
        u.onerror?.({ error: 'interrupted' });
      }
    },
    pause() { fake.paused = true; },
    resume() { fake.paused = false; },
    addEventListener() {}, removeEventListener() {},
  };
  let ok = false;
  try {
    Object.defineProperty(window, 'speechSynthesis', { get: () => fake, configurable: true });
    ok = window.speechSynthesis === fake;
  } catch (_) { ok = false; }
  if (ok) document.documentElement.dataset.voxSpeechMock = '1';
})();
