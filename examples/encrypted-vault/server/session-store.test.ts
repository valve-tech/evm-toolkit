import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSessionStore } from './session-store'

const ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const

afterEach(() => vi.useRealTimers())

describe('session store', () => {
  it('issues an opaque token that validates back to the address', () => {
    const store = createSessionStore()
    const token = store.issue(ADDR)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(32)
    expect(store.validate(token)).toBe(ADDR)
  })

  it('returns null for an unknown token', () => {
    const store = createSessionStore()
    expect(store.validate('garbage')).toBeNull()
  })

  it('returns null after the token expires', () => {
    vi.useFakeTimers()
    const store = createSessionStore({ ttlMs: 1000 })
    const token = store.issue(ADDR)
    vi.advanceTimersByTime(1001)
    expect(store.validate(token)).toBeNull()
  })

  it('issues distinct tokens per call', () => {
    const store = createSessionStore()
    expect(store.issue(ADDR)).not.toBe(store.issue(ADDR))
  })
})
