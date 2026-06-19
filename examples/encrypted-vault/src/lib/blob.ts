/**
 * Wire-encoding for AES-GCM envelope blobs. The server stores these
 * base64 strings verbatim and never sees the plaintext or the key.
 * The `nonce` here is the AES-GCM IV from encryptEnvelope — NOT the
 * SIWE nonce from viem/siwe / @valve-tech/siwe-store (same word, different concept).
 */

/** The on-the-wire shape the server persists (base64 strings). */
export interface WireBlob {
  ciphertext: string
  nonce: string
}

/** The in-memory shape encryptEnvelope/decryptEnvelope use. */
export interface RawBlob {
  ciphertext: Uint8Array
  nonce: Uint8Array
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function encodeBlob(blob: RawBlob): WireBlob {
  return { ciphertext: bytesToBase64(blob.ciphertext), nonce: bytesToBase64(blob.nonce) }
}

export function decodeBlob(wire: WireBlob): RawBlob {
  return { ciphertext: base64ToBytes(wire.ciphertext), nonce: base64ToBytes(wire.nonce) }
}
