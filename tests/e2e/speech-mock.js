(function () {
  class MockSpeechSynthesisUtterance {
    constructor(text = '') {
      this.text = text;
      this.rate = 1;
      this.lang = 'en-US';
      this.voice = null;
      this.onboundary = null;
      this.onend = null;
      this.onerror = null;
    }
  }

  let active = null;
  let timers = [];
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  const speechSynthesis = {
    getVoices() {
      return [{ name: 'Vox Test Samantha', lang: 'en-US', default: true }];
    },
    addEventListener(type, listener) {
      if (type === 'voiceschanged') queueMicrotask(listener);
    },
    speak(utterance) {
      clearTimers();
      active = utterance;
      const words = utterance.text.trim().split(/\s+/).filter(Boolean);
      const interval = Math.max(35, 90 / Math.max(0.5, utterance.rate || 1));
      let charIndex = 0;
      words.forEach((word, index) => {
        timers.push(setTimeout(() => {
          if (active !== utterance) return;
          utterance.onboundary?.({ name: 'word', charIndex });
          charIndex += word.length + 1;
          if (index === words.length - 1) {
            active = null;
            utterance.onend?.();
          }
        }, interval * (index + 1)));
      });
    },
    cancel() {
      const previous = active;
      active = null;
      clearTimers();
      if (previous) queueMicrotask(() => previous.onerror?.({ error: 'interrupted' }));
    },
  };

  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: MockSpeechSynthesisUtterance,
  });
  Object.defineProperty(globalThis, 'speechSynthesis', {
    configurable: true,
    value: speechSynthesis,
  });
})(globalThis);
