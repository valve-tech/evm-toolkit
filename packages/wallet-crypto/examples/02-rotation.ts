/**
 * 02 — Key version rotation.
 *
 * Bumping `version` invalidates every blob encrypted under the old
 * key. The migration is per-product: decrypt with v1, re-encrypt
 * with v2. This script shows that flow plus a proof that the v1
 * ciphertext is NOT decryptable with the v2 key.
 *
 * Run with: yarn tsx packages/wallet-crypto/examples/02-rotation.ts
 */

import { createWalletClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import {
  deriveWalletEncryptionKey,
  encryptEnvelope,
  decryptEnvelope,
  DecryptionFailed,
} from '../src/index.js'

const account = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)
const walletClient = createWalletClient({ account, chain: mainnet, transport: http() })

// State at v1.
const keyV1 = await deriveWalletEncryptionKey({ signer: walletClient, purpose: 'demo', version: 1 })
const payload = new TextEncoder().encode('the v1 secret')
const { ciphertext, nonce } = await encryptEnvelope({ key: keyV1, plaintext: payload })

// Time passes. Rotate to v2.
const keyV2 = await deriveWalletEncryptionKey({ signer: walletClient, purpose: 'demo', version: 2 })

// v1 ciphertext is NOT decryptable with v2 key — proves cross-version isolation.
try {
  await decryptEnvelope({ key: keyV2, ciphertext, nonce })
  console.error('UNEXPECTED: v1 ciphertext decrypted under v2 key — security regression')
  process.exit(1)
} catch (err) {
  if (!(err instanceof DecryptionFailed)) throw err
  console.log('✓ cross-version isolation confirmed: v1 ciphertext rejected by v2 key')
}

// Migration step: decrypt with v1, re-encrypt with v2.
const recovered = await decryptEnvelope({ key: keyV1, ciphertext, nonce })
const reEnvelope = await encryptEnvelope({ key: keyV2, plaintext: recovered })
const finalCheck = await decryptEnvelope({
  key: keyV2,
  ciphertext: reEnvelope.ciphertext,
  nonce: reEnvelope.nonce,
})
console.log('✓ migrated:', new TextDecoder().decode(finalCheck))
