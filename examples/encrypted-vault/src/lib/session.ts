/**
 * Client session + wallet-derived key lifecycle.
 *
 * Two signatures total: (1) the SIWE sign-in (viem/siwe message), and
 * (2) the key-derivation sign (wallet-crypto), derived LAZILY on first
 * encrypt/decrypt with purpose "notes-vault" version 1. The key
 * lifecycle (derive-once, wipe on account-change / tab-close) is
 * @valve-tech/wallet-key-session's audited memory-only one.
 */
import { createKeySession, type Eip1193Like } from '@valve-tech/wallet-key-session'
import { deriveWalletEncryptionKey } from '@valve-tech/wallet-crypto'
import type { Address, WalletClient } from 'viem'

export const KEY_PURPOSE = 'notes-vault'
export const KEY_VERSION = 1

export interface Session {
  token: string
  address: Address
  client: WalletClient
}

/**
 * Returns a memoized key getter backed by `createKeySession`. The first
 * call triggers the personal_sign; later calls reuse the derived
 * CryptoKey, which is wiped on accountsChanged / chainChanged / tab
 * close.
 */
export function makeKeyProvider(session: Session): () => Promise<CryptoKey> {
  const keySession = createKeySession({
    address: session.address,
    derive: () =>
      deriveWalletEncryptionKey({
        signer: session.client,
        purpose: KEY_PURPOSE,
        version: KEY_VERSION,
      }),
    provider:
      typeof window !== 'undefined'
        ? (window.ethereum as Eip1193Like | undefined)
        : undefined,
  })
  return () => keySession.getKey()
}
