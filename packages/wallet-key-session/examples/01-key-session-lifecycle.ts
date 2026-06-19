/**
 * 01 — The memory-only key session lifecycle.
 *
 * Shows derive-once + auto-clear without a real wallet: the `derive`
 * callback and the EIP-1193 `provider` are both injectable, so we
 * stand in a throwaway key and a fake provider. In a browser app,
 * `derive` would call `deriveWalletEncryptionKey` from
 * `@valve-tech/wallet-crypto` and `provider` would be `window.ethereum`.
 *
 * Run with: yarn tsx packages/wallet-key-session/examples/01-key-session-lifecycle.ts
 */

import { createKeySession, type Eip1193Like } from '../src/index.js'

const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

let derivations = 0
async function fakeDerive(): Promise<CryptoKey> {
  derivations++
  return crypto.subtle.importKey('raw', new Uint8Array(32), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

// Fake provider so we can fire accountsChanged by hand.
const handlers: Record<string, Array<(...a: unknown[]) => void>> = {}
const provider: Eip1193Like = { on: (e, h) => { (handlers[e] ??= []).push(h) } }

const session = createKeySession({
  address: ADDRESS,
  derive: fakeDerive,
  provider,
  clearOnPageHide: false, // no DOM in this script
})

// Concurrent callers share ONE derivation.
await Promise.all([session.getKey(), session.getKey()])
await session.getKey()
console.log(`after 3 getKey() calls: ${derivations} derivation(s)`) // → 1

// Account change wipes the key; the next getKey() re-derives.
for (const h of handlers['accountsChanged'] ?? []) h()
await session.getKey()
console.log(`after accountsChanged + getKey(): ${derivations} derivation(s)`) // → 2
