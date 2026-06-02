import { describe, it, expect } from 'vitest'
import { generateAuthNonce } from './nonce.js'

describe('generateAuthNonce', () => {
  it('returns a base64url string with no padding by default', () => {
    const { nonce } = generateAuthNonce()
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(nonce.includes('=')).toBe(false)
  })

  it('default is 32 bytes → ~43 base64url chars', () => {
    const { nonce } = generateAuthNonce()
    // 32 bytes base64url = ceil(32*4/3) = 43 chars (no padding).
    expect(nonce.length).toBe(43)
  })

  it('respects custom bytes parameter', () => {
    const { nonce: n16 } = generateAuthNonce({ bytes: 16 })
    expect(n16.length).toBe(Math.ceil((16 * 4) / 3)) // 22 chars

    const { nonce: n64 } = generateAuthNonce({ bytes: 64 })
    expect(n64.length).toBe(Math.ceil((64 * 4) / 3)) // 86 chars
  })

  it('rejects bytes < 16', () => {
    expect(() => generateAuthNonce({ bytes: 8 })).toThrow(RangeError)
    expect(() => generateAuthNonce({ bytes: 15 })).toThrow(/between 16 and 64/)
  })

  it('rejects bytes > 64', () => {
    expect(() => generateAuthNonce({ bytes: 65 })).toThrow(RangeError)
  })

  it('expiresAt is now + ttlSeconds*1000', () => {
    const before = Date.now()
    const { expiresAt } = generateAuthNonce({ ttlSeconds: 300 })
    const after = Date.now()
    // expiresAt should be within [before+300_000, after+300_000].
    expect(expiresAt).toBeGreaterThanOrEqual(before + 300_000)
    expect(expiresAt).toBeLessThanOrEqual(after + 300_000)
  })

  it('respects default ttlSeconds (5 minutes)', () => {
    const before = Date.now()
    const { expiresAt } = generateAuthNonce()
    expect(expiresAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 10)
  })

  it('rejects ttlSeconds < 30', () => {
    expect(() => generateAuthNonce({ ttlSeconds: 10 })).toThrow(RangeError)
    expect(() => generateAuthNonce({ ttlSeconds: 29 })).toThrow(/between 30 and 3600/)
  })

  it('rejects ttlSeconds > 3600', () => {
    expect(() => generateAuthNonce({ ttlSeconds: 3601 })).toThrow(RangeError)
  })

  // Spec testing obligation #6: nonce uniqueness across 10k draws.
  it('10,000 calls produce 10,000 distinct nonces', () => {
    const set = new Set<string>()
    for (let i = 0; i < 10_000; i++) {
      set.add(generateAuthNonce().nonce)
    }
    expect(set.size).toBe(10_000)
  })
})
