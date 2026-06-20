/**
 * @fileoverview Public API of `@valve-tech/wallet-key-session`.
 *
 * Memory-only lifecycle for a wallet-derived encryption key. Pairs
 * `@valve-tech/wallet-crypto` (wire its `deriveWalletEncryptionKey`
 * into the `derive` callback).
 */

export { createKeySession } from './key-session.js'
export type { KeySession, Eip1193Like } from './key-session.js'
