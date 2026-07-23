# @valve-tech/siwe-store-redis — notes for agents

## What this package does

Redis-backed implementations of `@valve-tech/siwe-store`'s **async**
contracts: `createRedisNonceStore` → `AsyncNonceStore` (single-use
SIWE nonces) and `createRedisSessionStore` → `AsyncSessionStore`
(opaque address-bound sessions). Server-side only (`node:crypto`).

## Public API

```ts
import {
  createRedisNonceStore,   // ({ client, ttlSeconds?, keyPrefix? }) => AsyncNonceStore
  createRedisSessionStore, // ({ client, ttlMs?, keyPrefix? }) => AsyncSessionStore
  fromNodeRedisV5,         // adapter: node-redis v5 → RedisClientLike
  fromIoRedis,             // adapter: ioredis → RedisClientLike
  type RedisClientLike,    // the 3-command structural client surface
  type RedisSetOptions,
  type RedisNonceStoreOptions,
  type RedisSessionStoreOptions,
  type NodeRedisV5Like,
  type IoRedisLike,
} from '@valve-tech/siwe-store-redis'
```

## Invariants

1. **Zero runtime dependencies.** The stores type against the
   structural `RedisClientLike` (set/get/del); no Redis library is
   imported. node-redis v4 matches directly; v5 and ioredis go
   through the shipped adapters. Never add a client library to
   `dependencies`.
2. **Redis expiry is the single TTL authority.** `set` callers pass
   `PX`; nothing re-checks timestamps client-side. Any new method
   must keep TTL server-side.
3. **Nonce single-use = DEL atomicity.** `consume` succeeds iff
   `del()` returns 1. Do not restructure into GET-then-DEL — that
   reintroduces the race the delete-first contract exists to prevent.
4. **Claims cross a JSON wire boundary.** No bigints in claims;
   that's the consumer's hex-encode boundary (toolkit-wide rule).
5. **Contracts live in `@valve-tech/siwe-store`.** `AsyncNonceStore`
   / `AsyncSessionStore` / `Session` are imported from there
   (types-only). Don't fork local copies.

## Testing

Unit tests run against an in-process fake `RedisClientLike` that
models PX expiry — no Redis server needed for CI. If you change store
semantics, mirror the change in the fake faithfully.
