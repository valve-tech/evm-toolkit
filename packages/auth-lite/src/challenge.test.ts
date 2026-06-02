import { describe, it, expect } from 'vitest'
import { signAuthChallenge } from './challenge.js'
import { WalletDeclined, WalletUnavailable, InvalidNonce } from './errors.js'
import { formatAuthMessage } from './messages.js'
import { makeMockSigner, TEST_ADDRESS_A, TEST_PRIVATE_KEY_A, VALID_NONCE } from './test-helpers.js'
import type { WalletClient } from 'viem'

describe('signAuthChallenge', () => {
  it('returns address + signature + message for a happy-path call', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    const result = await signAuthChallenge({ signer, app: 'Test', nonce: VALID_NONCE })
    expect(result.address.toLowerCase()).toBe(TEST_ADDRESS_A.toLowerCase())
    expect(result.signature).toMatch(/^0x[0-9a-fA-F]{130}$/)
    expect(result.message).toBe(formatAuthMessage({ app: 'Test', nonce: VALID_NONCE }))
  })

  it('throws InvalidNonce on an empty-string nonce', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    await expect(
      signAuthChallenge({ signer, app: 'Test', nonce: '' }),
    ).rejects.toBeInstanceOf(InvalidNonce)
  })

  it('throws InvalidNonce on a too-short nonce', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    // 10 chars — under the 22-char floor.
    await expect(
      signAuthChallenge({ signer, app: 'Test', nonce: 'aaaaaaaaaa' }),
    ).rejects.toBeInstanceOf(InvalidNonce)
  })

  it('throws InvalidNonce on a non-base64url nonce', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    // Includes '!' which is not base64url-safe.
    await expect(
      signAuthChallenge({
        signer,
        app: 'Test',
        nonce: 'AbCdEfGhIjKlMnOpQrStUv!_AbCdE',
      }),
    ).rejects.toBeInstanceOf(InvalidNonce)
  })

  it('throws InvalidNonce on a non-string nonce', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    await expect(
      signAuthChallenge({
        signer,
        app: 'Test',
        nonce: 123 as unknown as string,
      }),
    ).rejects.toBeInstanceOf(InvalidNonce)
  })

  it('throws WalletUnavailable when signer has no account', async () => {
    const signer = { account: undefined, signMessage: async () => '0x' } as unknown as WalletClient
    await expect(
      signAuthChallenge({ signer, app: 'Test', nonce: VALID_NONCE }),
    ).rejects.toBeInstanceOf(WalletUnavailable)
  })

  it('throws WalletDeclined on EIP-1193 4001 rejection', async () => {
    const signer = {
      account: { address: TEST_ADDRESS_A, type: 'local' },
      signMessage: async () => {
        throw Object.assign(new Error('User rejected'), { code: 4001 })
      },
    } as unknown as WalletClient
    await expect(
      signAuthChallenge({ signer, app: 'Test', nonce: VALID_NONCE }),
    ).rejects.toBeInstanceOf(WalletDeclined)
  })

  it('re-throws non-rejection errors unchanged', async () => {
    const original = new Error('RPC timeout')
    const signer = {
      account: { address: TEST_ADDRESS_A, type: 'local' },
      signMessage: async () => { throw original },
    } as unknown as WalletClient
    await expect(
      signAuthChallenge({ signer, app: 'Test', nonce: VALID_NONCE }),
    ).rejects.toBe(original)
  })

  it('signs the same message for the same (app, nonce) — determinism', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    const r1 = await signAuthChallenge({ signer, app: 'A', nonce: VALID_NONCE })
    const r2 = await signAuthChallenge({ signer, app: 'A', nonce: VALID_NONCE })
    expect(r1.signature).toBe(r2.signature)
  })

  it('signs a different message for different app or nonce', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    const a = await signAuthChallenge({ signer, app: 'A', nonce: VALID_NONCE })
    const b = await signAuthChallenge({ signer, app: 'B', nonce: VALID_NONCE })
    expect(a.signature).not.toBe(b.signature)
  })
})
