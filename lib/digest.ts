/**
 * SHA-256 helpers for the verified vault.
 *
 * WebCrypto only: no dependency, no bundle weight, and no native bridge. The
 * platform gives us `crypto.subtle` in the Fire WebView (a secure `https://localhost`
 * origin) and on `localhost` in a browser. If a context is not secure we fail
 * loudly with an actionable message instead of pretending a digest exists.
 */

const encoder = new TextEncoder();

export function isAvailable(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function';
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let hex = '';
  for (const byte of view) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function requireSubtle(): SubtleCrypto {
  if (!isAvailable()) {
    throw new Error('Integrity checks need a secure context. Open the app over HTTPS, on localhost, or in the Fire tablet app.');
  }
  return crypto.subtle;
}

export async function sha256(data: BufferSource): Promise<string> {
  return toHex(await requireSubtle().digest('SHA-256', data));
}

export async function sha256Text(text: string): Promise<string> {
  return sha256(encoder.encode(text));
}

/** Digest of the exact stored bytes. Never trust a digest recorded alongside them. */
export async function blobDigest(blob: Blob): Promise<string> {
  return sha256(await blob.arrayBuffer());
}
