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
    chrome.downloads.download({ url, filename, saveAs: false }, (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        URL.revokeObjectURL(url);
        reject(new Error(chrome.runtime.lastError?.message || 'Download failed'));
        return;
      }
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
      resolve(id);
    });
  });
}

function downloadWavBlob(bytes, filename) {
  return downloadAudioBlob(bytes, filename, 'audio/wav');
}
