import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMemorySessionStore } from './session-store.js'

const ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const

afterEach(() => vi.useRealTimers())

describe('createMemorySessionStore', () => {
  it('issues an opaque token that validates back to the bound session', () => {
    const store = createMemorySessionStore()
    const token = store.issue(ADDR)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(32)
    const session = store.validate(token)
    expect(session?.address).toBe(ADDR)
    expect(typeof session?.issuedAt).toBe('number')
  })

  it('roundtrips claims', () => {
    const store = createMemorySessionStore()
    const token = store.issue(ADDR, { role: 'admin' })
    expect(store.validate(token)?.claims).toEqual({ role: 'admin' })
  })

  it('returns null for an unknown token', () => {
    const store = createMemorySessionStore()
    expect(store.validate('garbage')).toBeNull()
  })

  it('returns null after the token expires', () => {
    vi.useFakeTimers()
    const store = createMemorySessionStore({ ttlMs: 1000 })
    const token = store.issue(ADDR)
    vi.advanceTimersByTime(1001)
    expect(store.validate(token)).toBeNull()
  })

  it('returns null after revoke', () => {
    const store = createMemorySessionStore()
    const token = store.issue(ADDR)
    store.revoke(token)
    expect(store.validate(token)).toBeNull()
  })

  it('issues distinct tokens per call', () => {
    const store = createMemorySessionStore()
    expect(store.issue(ADDR)).not.toBe(store.issue(ADDR))
  })
})
