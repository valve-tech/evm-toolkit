/**
 * @fileoverview Redis-backed single-use SIWE nonce store.
 *
 * Implements `@valve-tech/siwe-store`'s `AsyncNonceStore` contract.
 * Single-use is enforced by Redis `DEL` atomicity: `consume` deletes
 * the key and succeeds iff the delete removed something, so exactly
 * one of two concurrent consumers wins — the same
 * delete-before-TTL-check guarantee as the in-memory store, provided
 * by the server instead of process memory. TTL is Redis expiry
 * (`SET … PX`); an expired nonce is simply gone by consume time.
 */

import { generateSiweNonce } from 'viem/siwe'
import type { AsyncNonceStore } from '@valve-tech/siwe-store'

import type { RedisClientLike } from './types.js'

/** Default nonce TTL: 5 minutes (mirrors `createMemoryNonceStore`). */
const DEFAULT_TTL_SECONDS = 5 * 60

/** Default key prefix for nonce keys. */
const DEFAULT_KEY_PREFIX = 'siwe:nonce:'

/** Options for {@link createRedisNonceStore}. */
export interface RedisNonceStoreOptions {
  /** The Redis client (or an adapter — see `adapters.ts`). */
  client: RedisClientLike
  /** Nonce TTL in seconds. Default 300 (5 minutes). */
  ttlSeconds?: number
  /**
   * Key prefix, so several apps can share one Redis without nonce
   * collisions. Default `'siwe:nonce:'`.
   */
  keyPrefix?: string
}

/** Create a Redis-backed single-use nonce store. */
export function createRedisNonceStore(
  options: RedisNonceStoreOptions,
): AsyncNonceStore {
  const { client, ttlSeconds = DEFAULT_TTL_SECONDS } = options
  const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX

  return {
    async issue() {
      const nonce = generateSiweNonce()
      await client.set(keyPrefix + nonce, '1', { PX: ttlSeconds * 1000 })
      return nonce
    },
    async consume(nonce) {
      // DEL's deleted-key count is the atomic single-use primitive:
      // exactly one concurrent consumer sees 1. Expired keys are
      // already gone server-side, so TTL needs no client-side check.
      return (await client.del(keyPrefix + nonce)) === 1
    },
  }
}
