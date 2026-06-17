/**
 * Client session + lazy encryption-key holder.
 *
 * Two signatures total: (1) the auth sign-in (auth-lite), (2) the
 * key-derivation sign (wallet-crypto), derived LAZILY on first
 * encrypt/decrypt with purpose "notes-vault" version 1. The README
 * explains why these are distinct prompts.
 */
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
 * Returns a memoized key getter. The first call triggers the
 * personal_sign; later calls reuse the derived CryptoKey.
 */
export function makeKeyProvider(session: Session): () => Promise<CryptoKey> {
  let cached: Promise<CryptoKey> | null = null
  return () => {
    cached ??= deriveWalletEncryptionKey({
      signer: session.client,
      purpose: KEY_PURPOSE,
      version: KEY_VERSION,
    })
    return cached
  }
}
