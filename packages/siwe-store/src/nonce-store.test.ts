import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMemoryNonceStore } from './nonce-store.js'

afterEach(() => vi.useRealTimers())

describe('createMemoryNonceStore', () => {
  it('issues a SIWE-valid nonce that consume() accepts exactly once', () => {
    const store = createMemoryNonceStore()
    const nonce = store.issue()
    expect(nonce).toMatch(/^[a-zA-Z0-9]{8,}$/) // generateSiweNonce shape
    expect(store.consume(nonce)).toBe(true)
    expect(store.consume(nonce)).toBe(false) // single-use: no replay
  })

  it('rejects an unknown nonce', () => {
    const store = createMemoryNonceStore()
    expect(store.consume('never-issued')).toBe(false)
  })

  it('rejects an expired nonce and removes it (delete-before-TTL ordering)', () => {
    vi.useFakeTimers()
    const store = createMemoryNonceStore({ ttlSeconds: 60 })
    const nonce = store.issue()
    vi.advanceTimersByTime(61_000)
    expect(store.consume(nonce)).toBe(false) // expired
    expect(store.consume(nonce)).toBe(false) // and already removed
  })
})
