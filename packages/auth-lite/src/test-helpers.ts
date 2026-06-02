/**
 * @fileoverview Test-only helpers (excluded from dist).
 */

import { privateKeyToAccount } from 'viem/accounts'
import type { WalletClient, Hex } from 'viem'

export function makeMockSigner(privateKey: Hex): WalletClient {
  const account = privateKeyToAccount(privateKey)
  return {
    account,
    signMessage: async (args: { account: unknown; message: string | { raw: Hex } }) =>
      account.signMessage({ message: args.message }),
  } as unknown as WalletClient
}

export const TEST_PRIVATE_KEY_A: Hex =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
export const TEST_PRIVATE_KEY_B: Hex =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

/** Stable derived addresses from the test private keys (anvil seed accounts 0 & 1). */
export const TEST_ADDRESS_A = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const
export const TEST_ADDRESS_B = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const

/** A well-formed base64url nonce — 32 bytes, 43 chars. */
export const VALID_NONCE = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE'
