// WAV download helper (loaded via importScripts in service_worker.js)

function base64ToUint8Array(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function downloadAudioBlob(bytes, filename, mimeType = 'application/octet-stream') {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const revokeWhenFinished = (downloadId) => {
      let fallbackTimer = null;
      const cleanup = () => {
        if (fallbackTimer) clearTimeout(fallbackTimer);
        chrome.downloads.onChanged.removeListener(onChanged);
        URL.revokeObjectURL(url);
      };
      const onChanged = (delta) => {
        if (delta.id !== downloadId) return;
        if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
          cleanup();
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
      fallbackTimer = setTimeout(cleanup, 10 * 60_000);
    };
    const tryDownload = (saveAs) => {
      chrome.downloads.download({ url, filename, saveAs }, (id) => {
        if (chrome.runtime.lastError || id === undefined) {
          if (!saveAs) {
            tryDownload(true);
            return;
          }
          URL.revokeObjectURL(url);
          reject(new Error(chrome.runtime.lastError?.message || 'Download failed'));
          return;
        }
        revokeWhenFinished(id);
        resolve(id);
      });
    };
    tryDownload(false);
  });
}

function downloadWavBlob(bytes, filename) {
  return downloadAudioBlob(bytes, filename, 'audio/wav');
}
