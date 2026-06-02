/**
 * 01 — Derive a wallet-bound key and roundtrip a payload.
 *
 * Shows the canonical 4-step shape: connect wallet → derive key →
 * encrypt → decrypt. Uses a viem `LocalAccount` (privateKeyToAccount)
 * as the "wallet" for a self-contained example; in a browser app, the
 * signer would be `createWalletClient({ transport: custom(window.ethereum) })`.
 *
 * Run with: yarn tsx packages/wallet-crypto/examples/01-derive-and-roundtrip.ts
 */

import { createWalletClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import {
  deriveWalletEncryptionKey,
  encryptEnvelope,
  decryptEnvelope,
} from '../src/index.js'

// In a real browser app, this is:
//   createWalletClient({ chain: mainnet, transport: custom(window.ethereum) })
// We use a privateKey-backed account here so this script runs anywhere
// without a wallet connection.
const account = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)
const walletClient = createWalletClient({
  account,
  chain: mainnet,
  transport: http(),
})

// 1. Derive the encryption key. Same wallet + same purpose + same
//    version → same key, on any device.
const key = await deriveWalletEncryptionKey({
  signer: walletClient,
  purpose: 'demo-workspaces',
  version: 1,
})

console.log('derived key algorithm:', key.algorithm.name, '/ extractable:', key.extractable)

// 2. Encrypt a payload. AAD binds the envelope version so a downgrade
//    attack can't swap a v2 ciphertext for a v1 one (or vice versa).
const plaintext = new TextEncoder().encode(
  JSON.stringify({ workspaces: [{ id: 'demo', name: 'Demo Workspace' }] }),
)
const aad = new TextEncoder().encode('envelope-v1')

const { ciphertext, nonce } = await encryptEnvelope({ key, plaintext, aad })
console.log(`encrypted ${plaintext.byteLength} bytes → ${ciphertext.byteLength} bytes ciphertext + 12-byte nonce`)

// 3. Decrypt with the same (key, nonce, aad). Decryption fails if any
//    of: wrong key, tampered ciphertext, different aad, different nonce.
const decrypted = await decryptEnvelope({ key, ciphertext, nonce, aad })
const recovered = JSON.parse(new TextDecoder().decode(decrypted))

console.log('roundtrip OK — recovered:', recovered)
