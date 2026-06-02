/**
 * @fileoverview Deterministic wallet-derived encryption key.
 *
 * Signs a fixed plaintext via the user's wallet (personal_sign), then
 * SHA-256s the signature to produce 256 bits of key material, then
 * imports those bits as a non-extractable AES-GCM CryptoKey. The
 * signature bytes never escape this function's scope.
 *
 * Why this works as a key-derivation primitive:
 *
 * - personal_sign is deterministic for a given (private key, message)
 *   pair — same wallet + same message → same signature, byte-for-byte.
 *   That's the property that makes the derived key reproducible.
 * - The SHA-256 step converts a variable-shape ECDSA signature into a
 *   uniform 256-bit key while losing nothing the key needs.
 * - `extractable: false` on importKey means a leak in app code can't
 *   exfiltrate the raw key material via `exportKey`.
 *
 * Security boundary: this function is the ONLY place the raw signature
 * bytes exist. They're created on the call to `signer.signMessage`,
 * hashed once, then go out of scope. Don't log, don't expose, don't
 * cache.
 */

import type { WalletClient } from 'viem'
import { hexToBytes } from 'viem'
import { isUserRejectionError } from '@valve-tech/viem-errors'
import { formatKeyDerivationMessage } from './messages.js'
import { WalletDeclined, WalletUnavailable } from './errors.js'

/**
 * Derive a deterministic 256-bit AES-GCM key from a wallet signature.
 *
 * Throws {@link WalletDeclined} if the user rejects the signature
 * prompt (any of the EIP-1193 4001 / class name / message regex
 * signals that `@valve-tech/viem-errors` knows about).
 *
 * Throws {@link WalletUnavailable} if the `WalletClient` has no
 * `account` set.
 *
 * @example
 * ```ts
 * const key = await deriveWalletEncryptionKey({
 *   signer: walletClient,
 *   purpose: 'explore-workspaces',
 *   version: 1,
 * })
 * const { ciphertext, nonce } = await encryptEnvelope({ key, plaintext })
 * ```
 */
export async function deriveWalletEncryptionKey(opts: {
  /** Connected viem WalletClient. Must have an `account`. */
  signer: WalletClient
  /**
   * App-specific purpose. Different purpose → different key, even for
   * the same wallet. Convention: kebab-case, app-namespaced
   * (e.g. `explore-workspaces`).
   */
  purpose: string
  /**
   * Schema version. Bumping invalidates every blob encrypted with the
   * prior version — the caller owns the re-encryption migration.
   */
  version: number
  /**
   * WebCrypto key-usage tags. Default: `['encrypt', 'decrypt']`.
   * Narrow further if the consumer only ever decrypts (e.g.
   * `['decrypt']` for a read-replica that never writes).
   */
  usages?: KeyUsage[]
}): Promise<CryptoKey> {
  const account = opts.signer.account
  if (!account) {
    throw new WalletUnavailable()
  }

  const message = formatKeyDerivationMessage({
    purpose: opts.purpose,
    version: opts.version,
  })

  // signer.signMessage is the ONLY place the raw signature is produced.
  // The variable is scoped to this function and not returned, logged,
  // or stored anywhere else. After we hash it below, the binding
  // becomes eligible for GC.
  let signatureHex: `0x${string}`
  try {
    signatureHex = await opts.signer.signMessage({ account, message })
  } catch (err) {
    if (isUserRejectionError(err)) {
      throw new WalletDeclined()
    }
    throw err
  }

  // Hex → bytes → SHA-256 → 256-bit key material.
  //
  // The `new Uint8Array(...)` copy narrows the buffer type from
  // viem's loose `Uint8Array<ArrayBufferLike>` (which could be
  // SharedArrayBuffer-backed) to a fresh `Uint8Array<ArrayBuffer>` —
  // WebCrypto's `subtle.digest` rejects the SAB-backed variant at the
  // type level. Runtime semantics are unchanged.
  const signatureBytes = new Uint8Array(hexToBytes(signatureHex))
  const keyMaterial = await crypto.subtle.digest('SHA-256', signatureBytes)

  // importKey copies the bytes into the CryptoKey's opaque slot;
  // `extractable: false` means no API surface can later recover them.
  const usages = opts.usages ?? ['encrypt', 'decrypt']
  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM' },
    /* extractable */ false,
    usages,
  )
}
