/**
 * @fileoverview AES-GCM authenticated encryption envelope.
 *
 * Thin wrapper over `crypto.subtle.encrypt`/`decrypt` with:
 *
 * - 12-byte random IV per call (the AES-GCM standard size; using
 *   anything else weakens the security proof).
 * - Optional AAD (additional associated data) — bound to the
 *   ciphertext but not encrypted. Use for protocol metadata that a
 *   downgrade attack must not be able to swap (e.g. envelope
 *   version, app id).
 * - 96-bit authentication tag (the AES-GCM default; appended to
 *   ciphertext by `subtle.encrypt`). Tamper-evidence is automatic.
 *
 * **WARNING (this is the most common caller error):** the `nonce`
 * field returned and consumed by these functions is the AES-GCM
 * 12-byte IV. It is NOT the auth nonce from
 * `@valve-tech/auth-lite`'s `generateAuthNonce`. Different concept,
 * unfortunate name collision in the crypto literature. Don't pass
 * one where the other is expected.
 *
 * TS note on `as BufferSource` casts below: WebCrypto's lib.dom.d.ts
 * tightened `BufferSource` in recent TS releases to require
 * `Uint8Array<ArrayBuffer>` (excluding `SharedArrayBuffer`). Plain
 * `Uint8Array` declarations widen to `Uint8Array<ArrayBufferLike>` and
 * no longer satisfy that constraint at the type level — but every
 * runtime handles both fine. The casts are a documented narrowing,
 * not a workaround for an actual bug.
 */

import { DecryptionFailed } from './errors.js'

const asAesGcmParams = (
  nonce: Uint8Array,
  aad: Uint8Array | undefined,
): AesGcmParams =>
  aad
    ? { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource }
    : { name: 'AES-GCM', iv: nonce as BufferSource }

/**
 * Encrypt `plaintext` under `key`. Generates a fresh 12-byte random
 * IV. The IV is returned alongside the ciphertext (not concatenated)
 * so callers can store it in a structured field.
 *
 * AES-GCM is deterministic for a fixed (key, IV, plaintext, AAD) —
 * but because the IV is fresh-random every call, two calls with the
 * same other inputs will produce different ciphertexts. That's the
 * desired property; nonce-reuse with the same key is catastrophic for
 * AES-GCM's security, so the IV being function-internal protects
 * naive callers from that footgun.
 */
export async function encryptEnvelope(opts: {
  /** AES-GCM key produced by {@link deriveWalletEncryptionKey}. */
  key: CryptoKey
  /** Bytes to encrypt. */
  plaintext: Uint8Array
  /**
   * Optional additional associated data. Bound to the ciphertext via
   * the AEAD tag — modifying it (or omitting it on decrypt) makes
   * decryption fail. Common use: envelope version, app identifier,
   * structural metadata that must not be downgraded.
   */
  aad?: Uint8Array
}): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const params = asAesGcmParams(nonce, opts.aad)
  const ciphertextBuffer = await crypto.subtle.encrypt(
    params,
    opts.key,
    opts.plaintext as BufferSource,
  )
  return { ciphertext: new Uint8Array(ciphertextBuffer), nonce }
}

/**
 * Decrypt `ciphertext` under `key`. Throws {@link DecryptionFailed}
 * if any of: the key is wrong, the ciphertext was tampered, the IV
 * (`nonce`) doesn't match, or the AAD doesn't match what was bound
 * at encrypt time.
 *
 * The failure is deliberately not differentiated — AEAD ciphertexts
 * are designed to surface a single "invalid" state without leaking
 * which specific check failed. Don't try to recover a more granular
 * reason from this function.
 */
export async function decryptEnvelope(opts: {
  key: CryptoKey
  ciphertext: Uint8Array
  /** The 12-byte IV returned by the matching `encryptEnvelope` call. */
  nonce: Uint8Array
  /** Must match the AAD used at encrypt time, if any. */
  aad?: Uint8Array
}): Promise<Uint8Array> {
  const params = asAesGcmParams(opts.nonce, opts.aad)
  try {
    const plaintextBuffer = await crypto.subtle.decrypt(
      params,
      opts.key,
      opts.ciphertext as BufferSource,
    )
    return new Uint8Array(plaintextBuffer)
  } catch {
    throw new DecryptionFailed()
  }
}
