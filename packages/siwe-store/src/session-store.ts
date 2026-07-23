/**
 * @fileoverview Opaque, address-bound session store.
 *
 * Issues a CSPRNG token (`randomBytes` base64url) bound to an address
 * (plus optional claims), with a TTL. The token is opaque — it carries
 * no signed state; the binding lives server-side. The `SessionStore`
 * interface is the contract for Redis/SQL backends;
 * `createMemorySessionStore` is the single-instance in-memory default.
 */

import { randomBytes } from 'node:crypto'
import type { Address } from 'viem'

/** A server-side session bound to an address. */
export interface Session {
  address: Address
  /** ms-epoch issuance time. */
  issuedAt: number
  /** Optional app-defined claims carried with the session. */
  claims?: Record<string, unknown>
}

/** Issue / validate / revoke opaque sessions. */
export interface SessionStore {
  /** Issue an opaque CSPRNG token bound to the address. */
  issue(address: Address, claims?: Record<string, unknown>): string
  /** The bound session if the token is valid + unexpired, else null. */
  validate(token: string): Session | null
  /** Invalidate a token (sign-out). */
  revoke(token: string): void
}

/**
 * Async variant of {@link SessionStore} — the contract for backends
 * whose I/O is inherently asynchronous (Redis, SQL). Same semantics
 * and the same opaque-token model.
 *
 * `@valve-tech/siwe-store-redis` implements this shape.
 */
export interface AsyncSessionStore {
  /** Issue an opaque CSPRNG token bound to the address. */
  issue(address: Address, claims?: Record<string, unknown>): Promise<string>
  /** The bound session if the token is valid + unexpired, else null. */
  validate(token: string): Promise<Session | null>
  /** Invalidate a token (sign-out). */
  revoke(token: string): Promise<void>
}

/**
 * Either session-store shape. Handler code that only ever `await`s
 * the results can type against this union — `await` is a no-op on the
 * sync store's plain values.
 */
export type AnySessionStore = SessionStore | AsyncSessionStore

/** Default session TTL: 30 minutes. */
const DEFAULT_TTL_MS = 30 * 60 * 1000

/** Create an in-memory opaque session store. */
export function createMemorySessionStore(opts?: { ttlMs?: number }): SessionStore {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS
  const sessions = new Map<string, { session: Session; expiresAt: number }>()

  return {
    issue(address, claims) {
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, {
        session: { address, issuedAt: Date.now(), claims },
        expiresAt: Date.now() + ttlMs,
      })
      return token
    },
    validate(token) {
      const stored = sessions.get(token)
      if (!stored) return null
      if (stored.expiresAt < Date.now()) {
        sessions.delete(token)
        return null
      }
      return stored.session
    },
    revoke(token) {
      sessions.delete(token)
    },
  }
}
