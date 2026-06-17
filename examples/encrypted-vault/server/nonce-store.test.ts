import { describe, it, expect, vi, afterEach } from 'vitest'
import { createNonceStore } from './nonce-store'

afterEach(() => vi.useRealTimers())

describe('nonce store', () => {
  it('issues a base64url nonce that consume() accepts exactly once', () => {
    const store = createNonceStore()
    const { nonce } = store.issue()
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(store.consume(nonce)).toBe(true)
    // one-time-use: a replay of the same nonce is rejected
    expect(store.consume(nonce)).toBe(false)
  })

  it('rejects an unknown nonce', () => {
    const store = createNonceStore()
    expect(store.consume('never-issued')).toBe(false)
  })

  it('rejects an expired nonce', () => {
    vi.useFakeTimers()
    const store = createNonceStore({ ttlSeconds: 60 })
    const { nonce } = store.issue()
    vi.advanceTimersByTime(61_000)
    expect(store.consume(nonce)).toBe(false)
  })
})
