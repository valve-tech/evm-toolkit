/**
 * @fileoverview Single-use, TTL'd SIWE nonce store.
 *
 * The replay defense for SIWE: a nonce is valid for exactly one
 * `consume()`. `consume()` deletes BEFORE the TTL check so a race-loser
 * cannot reuse a nonce that a concurrent caller already claimed.
 *
 * The `NonceStore` interface is the contract for Redis/SQL backends;
 * `createMemoryNonceStore` is the single-instance in-memory default
 * (resets on restart — see the README for the production path).
 */

import { generateSiweNonce } from 'viem/siwe'

/** Issue + single-use-consume a SIWE nonce. */
export interface NonceStore {
  /** Issue a fresh SIWE-valid nonce (`generateSiweNonce`) and remember it. */
  issue(): string
  /**
   * True iff the nonce was issued, unexpired, and unconsumed. Deletes on
   * lookup (atomic single-use, delete-before-TTL-check).
   */
  consume(nonce: string): boolean
}

/** Default nonce TTL: 5 minutes. */
const DEFAULT_TTL_SECONDS = 5 * 60

/** Create an in-memory single-use nonce store. */
export function createMemoryNonceStore(opts?: { ttlSeconds?: number }): NonceStore {
  const ttlMs = (opts?.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000
  const issued = new Map<string, number>() // nonce -> expiresAt (ms epoch)

  return {
    issue() {
      const nonce = generateSiweNonce()
      issued.set(nonce, Date.now() + ttlMs)
      return nonce
    },
    consume(nonce) {
      const expiresAt = issued.get(nonce)
      if (expiresAt === undefined) return false
      // Delete BEFORE the time check: a concurrent second consume of the
      // same nonce finds nothing, so a race-loser cannot reuse it.
      issued.delete(nonce)
      return expiresAt >= Date.now()
    },
  }
}
