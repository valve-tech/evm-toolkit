/**
 * Tests for the Redis-backed nonce + session stores.
 *
 * A fake `RedisClientLike` models the only Redis behaviors the stores
 * rely on: SET with PX applies a server-side TTL, GET/DEL observe it
 * lazily, and DEL returns the deleted-key count (the atomic
 * single-use primitive). Fake timers drive expiry deterministically.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRedisNonceStore } from './nonce-store.js'
import { createRedisSessionStore } from './session-store.js'
import type { RedisClientLike } from './types.js'

interface FakeRedis extends RedisClientLike {
  /** Raw handle for test assertions. */
  dump(): Map<string, { value: string; expiresAt: number | null }>
}

const makeFakeRedis = (): FakeRedis => {
  const entries = new Map<string, { value: string; expiresAt: number | null }>()

  const aliveEntry = (key: string) => {
    const entry = entries.get(key)
    if (!entry) return null
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      entries.delete(key)
      return null
    }
    return entry
  }

  return {
    set: async (key, value, options) => {
      entries.set(key, {
        value,
        expiresAt:
          options?.PX === undefined ? null : Date.now() + options.PX,
      })
      return 'OK'
    },
    get: async (key) => aliveEntry(key)?.value ?? null,
    del: async (key) => {
      if (aliveEntry(key) === null) return 0
      entries.delete(key)
      return 1
    },
    dump: () => entries,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Nonce store
// ---------------------------------------------------------------------------

describe('createRedisNonceStore', () => {
  it('issues a nonce and stores it under the prefix with the TTL', async () => {
    const redis = makeFakeRedis()
    const store = createRedisNonceStore({ client: redis, ttlSeconds: 60 })

    const nonce = await store.issue()
    expect(nonce.length).toBeGreaterThan(0)

    const key = `siwe:nonce:${nonce}`
    const entry = redis.dump().get(key)
    expect(entry).toBeDefined()
    expect(entry?.expiresAt).toBe(Date.now() + 60_000)
  })

  it('consume succeeds exactly once (atomic DEL)', async () => {
    const redis = makeFakeRedis()
    const store = createRedisNonceStore({ client: redis })

    const nonce = await store.issue()
    expect(await store.consume(nonce)).toBe(true)
    expect(await store.consume(nonce)).toBe(false)
  })

  it('consume is false for a nonce that was never issued', async () => {
    const store = createRedisNonceStore({ client: makeFakeRedis() })
    expect(await store.consume('never-issued')).toBe(false)
  })

  it('consume is false after the TTL elapses (default 5 min)', async () => {
    const redis = makeFakeRedis()
    const store = createRedisNonceStore({ client: redis })

    const nonce = await store.issue()
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    expect(await store.consume(nonce)).toBe(false)
  })

  it('honours a custom keyPrefix', async () => {
    const redis = makeFakeRedis()
    const store = createRedisNonceStore({
      client: redis,
      keyPrefix: 'myapp:n:',
    })
    const nonce = await store.issue()
    expect(redis.dump().has(`myapp:n:${nonce}`)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

const ADDRESS = '0x1111111111111111111111111111111111111111' as const

describe('createRedisSessionStore', () => {
  it('issues an opaque token and validates it back to the session', async () => {
    const store = createRedisSessionStore({ client: makeFakeRedis() })

    const token = await store.issue(ADDRESS, { role: 'admin' })
    expect(token.length).toBeGreaterThanOrEqual(32)

    const session = await store.validate(token)
    expect(session?.address).toBe(ADDRESS)
    expect(session?.claims).toEqual({ role: 'admin' })
    expect(session?.issuedAt).toBe(Date.now())
  })

  it('omits claims when none are supplied', async () => {
    const store = createRedisSessionStore({ client: makeFakeRedis() })
    const token = await store.issue(ADDRESS)
    const session = await store.validate(token)
    expect(session?.claims).toBeUndefined()
  })

  it('validate is null for an unknown token', async () => {
    const store = createRedisSessionStore({ client: makeFakeRedis() })
    expect(await store.validate('nope')).toBeNull()
  })

  it('validate is null after the TTL elapses (default 30 min)', async () => {
    const store = createRedisSessionStore({ client: makeFakeRedis() })
    const token = await store.issue(ADDRESS)
    vi.advanceTimersByTime(30 * 60 * 1000 + 1)
    expect(await store.validate(token)).toBeNull()
  })

  it('honours a custom ttlMs', async () => {
    const store = createRedisSessionStore({
      client: makeFakeRedis(),
      ttlMs: 1000,
    })
    const token = await store.issue(ADDRESS)
    vi.advanceTimersByTime(999)
    expect(await store.validate(token)).not.toBeNull()
    vi.advanceTimersByTime(2)
    expect(await store.validate(token)).toBeNull()
  })

  it('revoke invalidates the token', async () => {
    const store = createRedisSessionStore({ client: makeFakeRedis() })
    const token = await store.issue(ADDRESS)
    await store.revoke(token)
    expect(await store.validate(token)).toBeNull()
  })

  it('validate is null when the stored value is not a session payload', async () => {
    const redis = makeFakeRedis()
    const store = createRedisSessionStore({ client: redis })
    await redis.set('siwe:session:corrupt', 'not-json', { PX: 60_000 })
    expect(await store.validate('corrupt')).toBeNull()

    await redis.set('siwe:session:wrongshape', JSON.stringify({ nope: 1 }), {
      PX: 60_000,
    })
    expect(await store.validate('wrongshape')).toBeNull()
  })

  it('honours a custom keyPrefix', async () => {
    const redis = makeFakeRedis()
    const store = createRedisSessionStore({
      client: redis,
      keyPrefix: 'myapp:s:',
    })
    const token = await store.issue(ADDRESS)
    expect(redis.dump().has(`myapp:s:${token}`)).toBe(true)
  })
})
