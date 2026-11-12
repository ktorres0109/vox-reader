// Vox Reader — Media Session (media keys / Now Playing) for the offscreen player.
//
// Chromium only creates a media session for media *elements*, not bare Web Audio.
// So the AudioContext output is routed through a MediaStream into a hidden
// <audio> element, which is what the browser (and macOS Now Playing) sees.
// If that element cannot play, audio falls back to ctx.destination and the
// handlers are simply never called.

export function createMediaSession({ onAction }) {
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : null;
  let audioEl = null;
  let routed = false;
  let lastError = '';
  let state = 'none';

  if (ms) {
    const bind = (name, key) => {
      try { ms.setActionHandler(name, () => onAction(key)); } catch (_) { /* unsupported action */ }
    };
    bind('play', 'play');
    bind('pause', 'pause');
    bind('previoustrack', 'prev');
    bind('nexttrack', 'next');
    bind('stop', 'stop');
  }

  /** Returns the node sources should connect to. */
  function connect(ctx) {
    if (!ms || typeof ctx.createMediaStreamDestination !== 'function') return ctx.destination;
    try {
      const dest = ctx.createMediaStreamDestination();
      audioEl = new Audio();
      audioEl.srcObject = dest.stream;
      const gain = ctx.createGain();
      gain.connect(dest);
      routed = true;
      // If the element is refused playback, send audio straight out instead.
      audioEl.play().catch((err) => {
        lastError = String(err?.message || err);
        routed = false;
        try { gain.disconnect(); } catch (_) {}
        gain.connect(ctx.destination);
      });
      return gain;
    } catch (err) {
      lastError = String(err?.message || err);
      routed = false;
      return ctx.destination;
    }
  }

  function setMetadata({ title, artist, album }) {
    if (!ms || typeof MediaMetadata === 'undefined') return;
    try {
      ms.metadata = new MediaMetadata({
        title: title || 'Vox Reader',
        artist: artist || 'Vox Reader',
        album: album || '',
        artwork: [{ src: chrome.runtime.getURL('icons/icon128.png'), sizes: '128x128', type: 'image/png' }],
      });
    } catch (_) {}
  }

  function setState(next) {
    state = next;
    if (ms) {
      try { ms.playbackState = next; } catch (_) {}
    }
    if (!audioEl || !routed) return;
    if (next === 'playing') audioEl.play().catch(() => {});
    else audioEl.pause();
  }

  function describe() {
    return {
      supported: !!ms,
      routedThroughElement: routed,
      elementPaused: audioEl ? audioEl.paused : null,
      playbackState: ms ? ms.playbackState : null,
      title: ms?.metadata?.title || null,
      state,
      lastError,
    };
  }

  return { connect, setMetadata, setState, describe };
}
