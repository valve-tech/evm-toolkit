/**
 * In-memory issued-nonce set. Single-use + TTL enforcement is the
 * caller's job per auth-lite invariant #1 — this is that caller.
 * consume() deletes on hit so a replayed nonce is rejected.
 */
import { generateAuthNonce } from '@valve-tech/auth-lite'
import { NONCE_TTL_SECONDS } from './config.js'

export interface NonceStore {
  issue(): { nonce: string }
  /** True if the nonce was issued, unexpired, and unconsumed. Deletes on hit. */
  consume(nonce: string): boolean
}

export function createNonceStore(opts?: { ttlSeconds?: number }): NonceStore {
  const ttlSeconds = opts?.ttlSeconds ?? NONCE_TTL_SECONDS
  const issued = new Map<string, { expiresAt: number }>()

  return {
    issue() {
      const { nonce, expiresAt } = generateAuthNonce({ ttlSeconds })
      issued.set(nonce, { expiresAt })
      return { nonce }
    },
    consume(nonce) {
      const stored = issued.get(nonce)
      if (!stored) return false
      // Atomic-ish delete BEFORE the time check so a race-loser can't reuse.
      issued.delete(nonce)
      if (stored.expiresAt < Date.now()) return false
      return true
    },
  }
}
