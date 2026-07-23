/**
 * @fileoverview Redis-backed opaque session store.
 *
 * Implements `@valve-tech/siwe-store`'s `AsyncSessionStore` contract:
 * an opaque CSPRNG token (never derived from the session content)
 * keys a JSON payload bound to an address. TTL is Redis expiry
 * (`SET … PX`) — validation never re-checks time client-side.
 *
 * Claims must be JSON-serializable — they cross the Redis wire
 * boundary as `JSON.stringify` output (no bigints; hex-encode at this
 * boundary if you carry chain values in claims).
 */

import { randomBytes } from 'node:crypto'
import type { Address } from 'viem'
import type { AsyncSessionStore, Session } from '@valve-tech/siwe-store'

import type { RedisClientLike } from './types.js'

/** Default session TTL: 30 minutes (mirrors `createMemorySessionStore`). */
const DEFAULT_TTL_MS = 30 * 60 * 1000

/** Default key prefix for session keys. */
const DEFAULT_KEY_PREFIX = 'siwe:session:'

/** Options for {@link createRedisSessionStore}. */
export interface RedisSessionStoreOptions {
  /** The Redis client (or an adapter — see `adapters.ts`). */
  client: RedisClientLike
  /** Session TTL in milliseconds. Default 1_800_000 (30 minutes). */
  ttlMs?: number
  /**
   * Key prefix, so several apps can share one Redis without session
   * collisions. Default `'siwe:session:'`.
   */
  keyPrefix?: string
}

/**
 * Parse a stored payload back into a `Session`, or null when the
 * value is not valid JSON or not session-shaped. A corrupt entry is
 * an invalid session, not a crash.
 */
function parseSession(raw: string): Session | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const candidate = parsed as { address?: unknown; issuedAt?: unknown }
  if (typeof candidate.address !== 'string') return null
  if (typeof candidate.issuedAt !== 'number') return null
  return parsed as Session
}

/** Create a Redis-backed opaque session store. */
export function createRedisSessionStore(
  options: RedisSessionStoreOptions,
): AsyncSessionStore {
  const { client, ttlMs = DEFAULT_TTL_MS } = options
  const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX

  return {
    async issue(address: Address, claims?: Record<string, unknown>) {
      const token = randomBytes(32).toString('base64url')
      const session: Session = {
        address,
        issuedAt: Date.now(),
        ...(claims === undefined ? {} : { claims }),
      }
      await client.set(keyPrefix + token, JSON.stringify(session), {
        PX: ttlMs,
      })
      return token
    },
    async validate(token) {
      const raw = await client.get(keyPrefix + token)
      if (raw === null) return null
      return parseSession(raw)
    },
    async revoke(token) {
      await client.del(keyPrefix + token)
    },
  }
}
