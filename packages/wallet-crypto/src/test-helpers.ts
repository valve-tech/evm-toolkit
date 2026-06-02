/**
 * @fileoverview Test-only helpers. Not exported from the package; not
 * shipped in the npm tarball (tsconfig excludes *.test.ts and this
 * file is only imported from tests).
 */

import { privateKeyToAccount } from 'viem/accounts'
import type { WalletClient, Hex } from 'viem'

/**
 * Build a minimal `WalletClient`-shaped object backed by a viem
 * `LocalAccount`. `LocalAccount.signMessage` is deterministic for a
 * given (private key, message) pair, which is the property the
 * key-derivation tests depend on.
 *
 * We don't build a real `createWalletClient` here because we don't
 * need a transport or chain — `deriveWalletEncryptionKey` only ever
 * touches `signer.account` and `signer.signMessage`.
 */
export function makeMockSigner(privateKey: Hex): WalletClient {
  const account = privateKeyToAccount(privateKey)
  return {
    account,
    signMessage: async (args: { account: unknown; message: string | { raw: Hex } }) =>
      // viem's LocalAccount.signMessage accepts the same shape for
      // both string and raw-bytes forms — pass through verbatim.
      account.signMessage({ message: args.message }),
  } as unknown as WalletClient
}

/**
 * Run a known-plaintext encryption with a fixed IV. Used by tests to
 * compare derived keys without ever extracting their raw bytes —
 * AES-GCM is deterministic for fixed (key, IV, plaintext, AAD), so
 * `fingerprint(k1) === fingerprint(k2)` iff the keys are equal.
 */
export async function fingerprintKey(key: CryptoKey): Promise<string> {
  const fixedIV = new Uint8Array(12) // all-zeros — only ever used here, never with real data
  const fixedPlaintext = new TextEncoder().encode('FINGERPRINT')
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: fixedIV as BufferSource },
    key,
    fixedPlaintext as BufferSource,
  )
  // Hex-encode for stable comparison + readable failure diffs.
  return Array.from(new Uint8Array(ct), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Stable 32-byte test private keys. */
export const TEST_PRIVATE_KEY_A: Hex =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
export const TEST_PRIVATE_KEY_B: Hex =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

/**
 * Fill arbitrary-sized buffer with cryptographic randomness.
 * `crypto.getRandomValues` caps at 65,536 bytes per call (WebCrypto
 * spec) so we chunk for the 1MB roundtrip test.
 */
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  const CHUNK = 65536
  for (let offset = 0; offset < n; offset += CHUNK) {
    crypto.getRandomValues(out.subarray(offset, Math.min(offset + CHUNK, n)))
  }
  return out
}
