import { describe, it, expect, vi } from 'vitest'
import { createSiweMessage } from 'viem/siwe'
import { privateKeyToAccount } from 'viem/accounts'
import type { Address, Hex } from 'viem'
import { authenticateSiwe, type SiweConfig } from './siwe-auth'

// Anvil account #0 — a real EOA we can sign with locally.
const account = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)

const CONFIG: SiweConfig = {
  domain: 'localhost',
  uri: 'http://localhost',
  chainId: 1,
  version: '1',
}

function buildMessage(
  overrides: Partial<{ domain: string; uri: string; chainId: number; address: Address; expirationTime: Date }> = {},
): string {
  return createSiweMessage({
    address: overrides.address ?? account.address,
    domain: overrides.domain ?? CONFIG.domain,
    uri: overrides.uri ?? CONFIG.uri,
    version: '1',
    chainId: overrides.chainId ?? CONFIG.chainId,
    nonce: 'deadbeef00', // 10 alphanumeric — EIP-4361 conformant
    issuedAt: new Date('2020-01-01T00:00:00Z'),
    expirationTime: overrides.expirationTime ?? new Date('2999-01-01T00:00:00Z'),
  })
}

const sign = (message: string): Promise<Hex> => account.signMessage({ message })
const consumeOk = (): boolean => true

describe('authenticateSiwe', () => {
  it('returns the address for a valid EOA login', async () => {
    const message = buildMessage()
    const signature = await sign(message)
    const addr = await authenticateSiwe({
      message,
      signature,
      config: CONFIG,
      consumeNonce: consumeOk,
      verifySignature: vi.fn(async () => true),
    })
    expect(addr).toBe(account.address)
  })

  it('rejects a substituted chainId BEFORE the signature is checked (field pin)', async () => {
    const verifySignature = vi.fn(async () => true)
    const message = buildMessage({ chainId: 999 })
    const signature = await sign(message)
    const addr = await authenticateSiwe({
      message,
      signature,
      config: CONFIG,
      consumeNonce: consumeOk,
      verifySignature,
    })
    expect(addr).toBeNull()
    expect(verifySignature).not.toHaveBeenCalled()
  })

  it('rejects a substituted uri (field pin)', async () => {
    const message = buildMessage({ uri: 'http://evil.example' })
    const signature = await sign(message)
    expect(
      await authenticateSiwe({
        message,
        signature,
        config: CONFIG,
        consumeNonce: consumeOk,
        verifySignature: vi.fn(async () => true),
      }),
    ).toBeNull()
  })

  it('rejects a consumed / replayed nonce', async () => {
    const message = buildMessage()
    const signature = await sign(message)
    expect(
      await authenticateSiwe({
        message,
        signature,
        config: CONFIG,
        consumeNonce: () => false,
        verifySignature: vi.fn(async () => true),
      }),
    ).toBeNull()
  })

  it('rejects an expired message', async () => {
    const message = buildMessage({ expirationTime: new Date('2020-01-02T00:00:00Z') })
    const signature = await sign(message)
    expect(
      await authenticateSiwe({
        message,
        signature,
        config: CONFIG,
        consumeNonce: consumeOk,
        verifySignature: vi.fn(async () => true),
      }),
    ).toBeNull()
  })

  it('rejects an invalid signature (verifier returns false)', async () => {
    const message = buildMessage()
    const signature = await sign(message)
    expect(
      await authenticateSiwe({
        message,
        signature,
        config: CONFIG,
        consumeNonce: consumeOk,
        verifySignature: vi.fn(async () => false),
      }),
    ).toBeNull()
  })

  it('returns null when the verifier throws (defensive — any thrown error rejects)', async () => {
    // Note: an unreachable RPC does NOT throw here — viem's verifyMessage
    // returns `false` on a failed eth_call, which the `!valid` branch
    // rejects. This covers the separate `catch` arm (a programming error
    // in the verifier), which must also fail closed.
    const message = buildMessage()
    const signature = await sign(message)
    expect(
      await authenticateSiwe({
        message,
        signature,
        config: CONFIG,
        consumeNonce: consumeOk,
        verifySignature: vi.fn(async () => {
          throw new Error('rpc down')
        }),
      }),
    ).toBeNull()
  })

  it('rejects an unparseable message without burning a nonce', async () => {
    // parseSiweMessage returns {} for garbage (it does not throw); the
    // missing nonce short-circuits BEFORE consumeNonce, so a never-issued
    // nonce is never consumed.
    const consumeNonce = vi.fn(() => true)
    const verifySignature = vi.fn(async () => true)
    const addr = await authenticateSiwe({
      message: 'not a siwe message',
      signature: '0x' as Hex,
      config: CONFIG,
      consumeNonce,
      verifySignature,
    })
    expect(addr).toBeNull()
    expect(consumeNonce).not.toHaveBeenCalled()
    expect(verifySignature).not.toHaveBeenCalled()
  })

  it('rejects a substituted domain', async () => {
    const message = buildMessage({ domain: 'evil.example' })
    const signature = await sign(message)
    expect(
      await authenticateSiwe({
        message,
        signature,
        config: CONFIG,
        consumeNonce: consumeOk,
        verifySignature: vi.fn(async () => true),
      }),
    ).toBeNull()
  })

  it('rejects a substituted version (field pin)', async () => {
    // createSiweMessage only emits version '1', so forge the line directly.
    const verifySignature = vi.fn(async () => true)
    const message = buildMessage().replace('Version: 1', 'Version: 2')
    const signature = await sign(message)
    const addr = await authenticateSiwe({
      message,
      signature,
      config: CONFIG,
      consumeNonce: consumeOk,
      verifySignature,
    })
    expect(addr).toBeNull()
    expect(verifySignature).not.toHaveBeenCalled()
  })

  it('authenticates a smart-contract account via the injected verifier (EIP-1271/6492)', async () => {
    // A contract address the signature does NOT ecrecover to. The
    // injected verifier (a PublicClient.verifyMessage in production)
    // returns true for a valid 1271/6492 signature; authenticateSiwe
    // must trust that verdict rather than doing EOA-only recovery.
    const contract = '0x1111111111111111111111111111111111111111' as Address
    const message = buildMessage({ address: contract })
    const signature = '0xdeadbeef' as Hex // opaque contract signature
    const verifySignature = vi.fn(async () => true)
    const addr = await authenticateSiwe({
      message,
      signature,
      config: CONFIG,
      consumeNonce: consumeOk,
      verifySignature,
    })
    expect(addr).toBe(contract)
    expect(verifySignature).toHaveBeenCalledWith({ address: contract, message, signature })
  })
})
