/**
 * @fileoverview Typed error classes raised by `@valve-tech/auth-lite`.
 *
 * Consumers branch on these with `instanceof` to render product-
 * appropriate UI (e.g. `WalletDeclined` → "Sign-in canceled" toast,
 * `InvalidNonce` → "Session expired, refresh and try again"). Generic
 * `Error` throws are not part of this package's contract.
 *
 * Naming intentionally overlaps with `@valve-tech/wallet-crypto`
 * (`WalletDeclined`, `WalletUnavailable`) so consumers using both
 * packages can write one catch arm for the shared cases.
 */

/**
 * The user actively declined the signature prompt in their wallet.
 * Caller should reset UI to idle.
 */
export class WalletDeclined extends Error {
  constructor(message = 'User declined the signature prompt') {
    super(message)
    this.name = 'WalletDeclined'
  }
}

/**
 * The provided `WalletClient` has no account connected. Caller should
 * prompt the user to connect a wallet before retrying.
 */
export class WalletUnavailable extends Error {
  constructor(message = 'WalletClient has no account connected') {
    super(message)
    this.name = 'WalletUnavailable'
  }
}

/**
 * The nonce failed a sanity check: not a base64url string of at least
 * 16 bytes (≥22 characters). Protects against accidental empty-string
 * signing — a server bug that returns `""` should not cause the
 * client to sign nothing.
 *
 * This does NOT mean "nonce is replayed" or "nonce expired" — that's
 * the caller's storage layer's job to detect; this is structural sanity
 * at the client-side boundary only.
 */
export class InvalidNonce extends Error {
  constructor(message = 'Nonce failed structural sanity check') {
    super(message)
    this.name = 'InvalidNonce'
  }
}

/**
 * Signature verification recovered an address, but it doesn't match
 * the `claimedAddress` the caller supplied. Indicates either:
 * - The frontend mis-echoed which account did the signing (UX bug).
 * - An attacker is replaying a signature against a different account.
 *
 * Either way, the verify path rejects.
 */
export class SignatureMismatch extends Error {
  constructor(message = 'Recovered address does not match claimed address') {
    super(message)
    this.name = 'SignatureMismatch'
  }
}
