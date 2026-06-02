/**
 * @fileoverview Public API of `@valve-tech/wallet-crypto`.
 *
 * Wallet-derived encryption keys + AES-GCM authenticated envelopes.
 * Pairs with `@valve-tech/auth-lite` (typed errors are intentionally
 * named the same where they overlap so consumers catch one class once).
 */

export { deriveWalletEncryptionKey } from './derive-key.js'
export { encryptEnvelope, decryptEnvelope } from './envelope.js'
export { formatKeyDerivationMessage } from './messages.js'
export { WalletDeclined, WalletUnavailable, DecryptionFailed } from './errors.js'
