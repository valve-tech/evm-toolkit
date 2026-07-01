/**
 * @fileoverview Public API of `@valve-tech/wallet-crypto`.
 *
 * Wallet-derived encryption keys + AES-GCM authenticated envelopes.
 * Pairs with `@valve-tech/wallet-key-session` (the memory-only
 * lifecycle of the derived key). SIWE auth is `viem/siwe` +
 * `@valve-tech/siwe-store`.
 */

export { deriveWalletEncryptionKey } from './derive-key.js'
export { encryptEnvelope, decryptEnvelope, rotateEnvelope } from './envelope.js'
export { formatKeyDerivationMessage } from './messages.js'
export { WalletDeclined, WalletUnavailable, DecryptionFailed } from './errors.js'
