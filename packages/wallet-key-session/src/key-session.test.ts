import { describe, it, expect, vi } from 'vitest'
import { createKeySession, type Eip1193Like } from './key-session.js'

const ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const

/** A throwaway non-extractable AES-GCM key — stands in for a derived key. */
async function makeKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new Uint8Array(32),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** A fake EIP-1193 provider whose events we can fire by hand. */
function fakeProvider(): { provider: Eip1193Like; fire: (event: string) => void } {
  const handlers: Record<string, Array<(...a: unknown[]) => void>> = {}
  return {
    provider: { on: (e, h) => { (handlers[e] ??= []).push(h) } },
    fire: (e) => { for (const h of handlers[e] ?? []) h() },
  }
}

describe('createKeySession', () => {
  it('derives the key exactly once across multiple and concurrent getKey() calls', async () => {
    const derive = vi.fn(makeKey)
    const ks = createKeySession({ address: ADDR, derive, clearOnPageHide: false })
    const [a, b] = await Promise.all([ks.getKey(), ks.getKey()])
    const c = await ks.getKey()
    expect(derive).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(a).toBe(c)
    expect(ks.address).toBe(ADDR)
  })

  it('clear() forces the next getKey() to re-derive', async () => {
    const derive = vi.fn(makeKey)
    const ks = createKeySession({ address: ADDR, derive, clearOnPageHide: false })
    await ks.getKey()
    ks.clear()
    await ks.getKey()
    expect(derive).toHaveBeenCalledTimes(2)
  })

  it('clears the key when the provider fires accountsChanged', async () => {
    const derive = vi.fn(makeKey)
    const { provider, fire } = fakeProvider()
    const ks = createKeySession({ address: ADDR, derive, provider, clearOnPageHide: false })
    await ks.getKey()
    fire('accountsChanged')
    await ks.getKey()
    expect(derive).toHaveBeenCalledTimes(2)
  })

  it('clears the key when the provider fires chainChanged', async () => {
    const derive = vi.fn(makeKey)
    const { provider, fire } = fakeProvider()
    const ks = createKeySession({ address: ADDR, derive, provider, clearOnPageHide: false })
    await ks.getKey()
    fire('chainChanged')
    await ks.getKey()
    expect(derive).toHaveBeenCalledTimes(2)
  })

  it('does not cache a rejected derivation — the next getKey() retries', async () => {
    const derive = vi
      .fn<() => Promise<CryptoKey>>()
      .mockRejectedValueOnce(new Error('declined'))
      .mockImplementation(makeKey)
    const ks = createKeySession({ address: ADDR, derive, clearOnPageHide: false })
    await expect(ks.getKey()).rejects.toThrow('declined')
    await expect(ks.getKey()).resolves.toBeDefined()
    expect(derive).toHaveBeenCalledTimes(2)
  })
})
