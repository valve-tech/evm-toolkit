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
 * 12-byte IV. It is NOT the SIWE nonce from `viem/siwe`'s
 * `generateSiweNonce` / `@valve-tech/siwe-store`. Different concept,
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

/**
 * Re-wrap one envelope from an old key to a new key — the per-blob
 * step of a key rotation.
 *
 * Rotation in this package means bumping the `version` passed to
 * {@link deriveWalletEncryptionKey}: a new version produces a different
 * key, which invalidates every blob encrypted under the prior one. The
 * caller derives both keys once (two wallet signatures total, whatever
 * the blob count), then maps every stored envelope through this
 * function. Nothing here is persisted — the caller owns reading the old
 * ciphertext and writing the returned one back.
 *
 * This is exactly `decryptEnvelope(oldKey)` followed by
 * `encryptEnvelope(newKey)`, offered as one call so the two easy
 * mistakes are structural rather than yours to avoid: the plaintext is
 * never handed back to the caller, and the AAD is swapped explicitly
 * (`oldAad` — what was bound under the old key — versus `newAad` — what
 * to bind under the new one; commonly the old and new version tags).
 *
 * A fresh random IV is generated for the new ciphertext, so the result
 * is unrelated to the input even when the plaintext is unchanged.
 *
 * Throws {@link DecryptionFailed} if the old key, `nonce`, or `oldAad`
 * don't match what produced the input envelope — a failed rotation
 * leaves the caller's stored ciphertext untouched (this function
 * returns nothing to write).
 *
 * @example
 * ```ts
 * const oldKey = await deriveWalletEncryptionKey({ signer, purpose, version: 1 })
 * const newKey = await deriveWalletEncryptionKey({ signer, purpose, version: 2 })
 * for (const blob of storedBlobs) {
 *   const rotated = await rotateEnvelope({
 *     oldKey, newKey,
 *     ciphertext: blob.ciphertext, nonce: blob.nonce,
 *     oldAad: v1Aad, newAad: v2Aad,
 *   })
 *   await store.put(blob.id, rotated) // { ciphertext, nonce }
 * }
 * ```
 */
export async function rotateEnvelope(opts: {
  /** Key the envelope was encrypted under (the version being retired). */
  oldKey: CryptoKey
  /** Key to re-encrypt under (the version being rotated to). */
  newKey: CryptoKey
  /** Existing ciphertext to re-wrap. */
  ciphertext: Uint8Array
  /** The 12-byte IV that matches `ciphertext`. */
  nonce: Uint8Array
  /** AAD bound under `oldKey`, if any. Must match or decryption fails. */
  oldAad?: Uint8Array
  /** AAD to bind under `newKey`, if any. Commonly the new version tag. */
  newAad?: Uint8Array
}): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const plaintext = await decryptEnvelope({
    key: opts.oldKey,
    ciphertext: opts.ciphertext,
    nonce: opts.nonce,
    aad: opts.oldAad,
  })
  return encryptEnvelope({ key: opts.newKey, plaintext, aad: opts.newAad })
}
