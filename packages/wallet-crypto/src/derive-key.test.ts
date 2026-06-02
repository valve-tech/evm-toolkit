import { describe, it, expect } from 'vitest'
import { deriveWalletEncryptionKey } from './derive-key.js'
import { WalletDeclined, WalletUnavailable } from './errors.js'
import { fingerprintKey, makeMockSigner, TEST_PRIVATE_KEY_A, TEST_PRIVATE_KEY_B } from './test-helpers.js'
import type { WalletClient } from 'viem'

describe('deriveWalletEncryptionKey', () => {
  it('throws WalletUnavailable when the signer has no account', async () => {
    const signer = { account: undefined, signMessage: async () => '0x00' } as unknown as WalletClient
    await expect(
      deriveWalletEncryptionKey({ signer, purpose: 'p', version: 1 }),
    ).rejects.toBeInstanceOf(WalletUnavailable)
  })

  it('returns a non-extractable CryptoKey', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    const key = await deriveWalletEncryptionKey({ signer, purpose: 'p', version: 1 })
    expect(key.extractable).toBe(false)
    expect(key.algorithm.name).toBe('AES-GCM')
    expect(key.usages.sort()).toEqual(['decrypt', 'encrypt'])
  })

  it('respects a custom usages array', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    const key = await deriveWalletEncryptionKey({
      signer,
      purpose: 'p',
      version: 1,
      usages: ['decrypt'],
    })
    expect(key.usages).toEqual(['decrypt'])
  })

  // Spec testing obligation #1: determinism.
  it('is deterministic — same wallet+purpose+version → identical key material', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    const k1 = await deriveWalletEncryptionKey({ signer, purpose: 'p', version: 1 })
    const k2 = await deriveWalletEncryptionKey({ signer, purpose: 'p', version: 1 })
    expect(await fingerprintKey(k1)).toBe(await fingerprintKey(k2))
  })

  // Spec testing obligation #2: cross-purpose isolation.
  it('different purpose → different key', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    const ka = await deriveWalletEncryptionKey({ signer, purpose: 'a', version: 1 })
    const kb = await deriveWalletEncryptionKey({ signer, purpose: 'b', version: 1 })
    expect(await fingerprintKey(ka)).not.toBe(await fingerprintKey(kb))
  })

  // Spec testing obligation #3: cross-version isolation.
  it('different version → different key (rotation)', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    const v1 = await deriveWalletEncryptionKey({ signer, purpose: 'p', version: 1 })
    const v2 = await deriveWalletEncryptionKey({ signer, purpose: 'p', version: 2 })
    expect(await fingerprintKey(v1)).not.toBe(await fingerprintKey(v2))
  })

  it('different wallets → different keys (same purpose+version)', async () => {
    const signerA = makeMockSigner(TEST_PRIVATE_KEY_A)
    const signerB = makeMockSigner(TEST_PRIVATE_KEY_B)
    const ka = await deriveWalletEncryptionKey({ signer: signerA, purpose: 'p', version: 1 })
    const kb = await deriveWalletEncryptionKey({ signer: signerB, purpose: 'p', version: 1 })
    expect(await fingerprintKey(ka)).not.toBe(await fingerprintKey(kb))
  })

  it('throws WalletDeclined when signMessage throws an EIP-1193 4001', async () => {
    const signer = {
      account: { address: '0xdead', type: 'local' },
      signMessage: async () => {
        throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      },
    } as unknown as WalletClient
    await expect(
      deriveWalletEncryptionKey({ signer, purpose: 'p', version: 1 }),
    ).rejects.toBeInstanceOf(WalletDeclined)
  })

  it('re-throws non-rejection errors unchanged', async () => {
    const original = new Error('Network down')
    const signer = {
      account: { address: '0xdead', type: 'local' },
      signMessage: async () => { throw original },
    } as unknown as WalletClient
    await expect(
      deriveWalletEncryptionKey({ signer, purpose: 'p', version: 1 }),
    ).rejects.toBe(original)
  })
})
