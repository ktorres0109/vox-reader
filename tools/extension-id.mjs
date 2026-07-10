import crypto from 'node:crypto';
import path from 'node:path';

/** Chrome unpacked extension id (deterministic from absolute path). */
export function unpackedExtensionId(extensionPath) {
  const normalized = path.resolve(extensionPath);
  const hex = crypto.createHash('sha256').update(normalized).digest('hex');
  return [...hex.slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}
