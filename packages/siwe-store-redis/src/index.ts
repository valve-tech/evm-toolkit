/**
 * @fileoverview Public API of `@valve-tech/siwe-store-redis`.
 *
 * Redis-backed implementations of `@valve-tech/siwe-store`'s async
 * contracts — `AsyncNonceStore` (single-use, TTL'd, atomic consume via
 * DEL) and `AsyncSessionStore` (opaque CSPRNG tokens, Redis expiry).
 * Bring your own client: everything types against the minimal
 * `RedisClientLike` surface; node-redis v4 fits directly, adapters
 * cover node-redis v5 and ioredis.
 */

export { createRedisNonceStore } from './nonce-store.js'
export type { RedisNonceStoreOptions } from './nonce-store.js'
export { createRedisSessionStore } from './session-store.js'
export type { RedisSessionStoreOptions } from './session-store.js'
export { fromIoRedis, fromNodeRedisV5 } from './adapters.js'
export type { IoRedisLike, NodeRedisV5Like } from './adapters.js'
export type { RedisClientLike, RedisSetOptions } from './types.js'
