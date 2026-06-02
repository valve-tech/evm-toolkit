/**
 * @fileoverview Typed error classes raised by `@valve-tech/wallet-crypto`.
 *
 * Consumers branch on these with `instanceof` to render product-
 * appropriate UI (e.g. `WalletDeclined` → cancelled toast,
 * `DecryptionFailed` → "couldn't open your encrypted backup" prompt).
 * Generic `Error` throws are not part of this package's contract —
 * `verify(err)` callers should be able to write `if (err instanceof
 * DecryptionFailed)` without parsing `.message` text.
 */

/**
 * The user actively declined the signature prompt in their wallet
 * (EIP-1193 code 4001 or equivalent class/message). The caller should
 * reset UI to idle, not show an error toast.
 */
export class WalletDeclined extends Error {
  constructor(message = 'User declined the signature prompt') {
    super(message)
    this.name = 'WalletDeclined'
  }
}

/**
 * The provided `WalletClient` has no account connected (or the account
 * is locked / unavailable). The caller should prompt the user to
 * connect a wallet before retrying.
 */
export class WalletUnavailable extends Error {
  constructor(message = 'WalletClient has no account connected') {
    super(message)
    this.name = 'WalletUnavailable'
  }
}

/**
 * AES-GCM authenticated decryption failed. This means at least one of:
 *
 * - The key is wrong (different wallet, different purpose, different
 *   version, or otherwise non-matching key material).
 * - The ciphertext was tampered with.
 * - The associated data (AAD) doesn't match what was bound at encrypt
 *   time — e.g. envelope-version downgrade attack.
 * - The 12-byte AES-GCM nonce doesn't match.
 *
 * The thrown error deliberately does NOT distinguish between these
 * causes. AEAD failures are a single observable state to the caller;
 * leaking the reason would weaken the security guarantee.
 */
export class DecryptionFailed extends Error {
  constructor(message = 'Decryption failed') {
    super(message)
    this.name = 'DecryptionFailed'
  }
}
