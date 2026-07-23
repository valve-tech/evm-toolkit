---
name: siwe-store-redis-integration
description: Use when wiring SIWE (Sign-In with Ethereum) server state to Redis — replacing @valve-tech/siwe-store's in-memory nonce/session stores for multi-process or restart-surviving deployments, choosing between node-redis v4/v5/ioredis adapters, or implementing the RedisClientLike surface for another client. Covers createRedisNonceStore, createRedisSessionStore, fromNodeRedisV5, fromIoRedis.
---

# Redis-backed SIWE state

`@valve-tech/siwe-store-redis` is the production backend for
`@valve-tech/siwe-store`'s contracts. Reach for it the moment the app
runs more than one server process or must survive restarts — the
in-memory stores are single-instance by design.

## Wire it up

```ts
import { createClient } from 'redis'
import {
  createRedisNonceStore,
  createRedisSessionStore,
  fromNodeRedisV5,
} from '@valve-tech/siwe-store-redis'

const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()
const client = fromNodeRedisV5(redis)

const nonces = createRedisNonceStore({ client })       // 5 min TTL
const sessions = createRedisSessionStore({ client })   // 30 min TTL
```

Pick the client path by library:

- node-redis **v4** — pass the client directly (matches
  `RedisClientLike` structurally).
- node-redis **v5** — wrap with `fromNodeRedisV5` (v5 moved SET TTLs
  under `expiration`).
- ioredis — wrap with `fromIoRedis`.
- Other/own client — implement `RedisClientLike`: `set(key, value,
  { PX })` applying a server-side TTL, `get`, `del` returning the
  deleted count.

## The flow is the same as in-memory, just awaited

```ts
// issue nonce for the SIWE message
const nonce = await nonces.issue()

// verify: consume is single-use — false means replay OR expiry
if (!(await nonces.consume(parsed.nonce))) reject()

// on success: opaque session token, validate per request, revoke on sign-out
const token = await sessions.issue(address, claims)
const session = await sessions.validate(token) // Session | null
await sessions.revoke(token)
```

Handler code that supports both backends types against
`AnyNonceStore` / `AnySessionStore` from `@valve-tech/siwe-store` and
always `await`s — `await` on the sync store's plain values is a no-op.

## Common mistakes

- **Re-checking TTLs client-side.** Redis expiry is the single
  source of truth; a client-side clock check adds skew bugs, not
  safety.
- **GET-then-DEL for nonce consume.** That's the replay race the
  atomic `DEL`-count contract prevents. Never restructure it.
- **Bigints in session claims.** Claims cross the Redis boundary as
  JSON — hex-encode chain values first (toolkit-wide wire rule).
- **Sharing one Redis across apps without prefixes.** Set `keyPrefix`
  per app (`'myapp:nonce:'`, `'myapp:session:'`) to prevent
  cross-app token collisions.
- **Expecting the package to connect for you.** You own the client's
  lifecycle (connect/reconnect/auth); the stores only issue commands.
