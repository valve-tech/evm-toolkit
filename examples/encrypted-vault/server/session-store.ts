/**
 * Opaque server-side session layer. auth-lite deliberately stops at
 * verify and issues NO session — this minimal token store is the
 * example's own layer on top of that boundary (the teaching point).
 * Random token → address, short TTL, in-memory.
 */
import { randomBytes } from 'node:crypto'
import type { Address } from 'viem'
import { SESSION_TTL_MS } from './config.js'

export interface SessionStore {
  issue(address: Address): string
  /** The bound address if the token is known and unexpired, else null. */
  validate(token: string): Address | null
}

export function createSessionStore(opts?: { ttlMs?: number }): SessionStore {
  const ttlMs = opts?.ttlMs ?? SESSION_TTL_MS
  const sessions = new Map<string, { address: Address; expiresAt: number }>()

  return {
    issue(address) {
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, { address, expiresAt: Date.now() + ttlMs })
      return token
    },
    validate(token) {
      const stored = sessions.get(token)
      if (!stored) return null
      if (stored.expiresAt < Date.now()) {
        sessions.delete(token)
        return null
      }
      return stored.address
    },
  }
}
