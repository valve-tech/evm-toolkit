# @valve-tech/siwe-store-redis

Redis-backed SIWE nonce + session stores — the production counterpart
to `@valve-tech/siwe-store`'s in-memory defaults, implementing its
`AsyncNonceStore` / `AsyncSessionStore` contracts.

## Why this exists

`@valve-tech/siwe-store`'s in-memory stores reset on restart and don't
share state across processes. The moment you run two server replicas —
or just restart one — nonces issued by one process must be consumable
by another, and sessions must survive a deploy. That's Redis's job:

- **Nonces** are single-use by Redis `DEL` atomicity — exactly one of
  two concurrent `consume` calls wins, the same
  delete-before-TTL-check guarantee as the in-memory store, enforced
  by the server instead of process memory.
- **Sessions** are opaque CSPRNG tokens keying a JSON payload bound to
  an address. TTLs are Redis expiry (`SET … PX`) — nothing re-checks
  clocks client-side.

## Install

```bash
yarn add @valve-tech/siwe-store-redis @valve-tech/siwe-store
# plus your Redis client of choice, e.g.
yarn add redis      # or: yarn add ioredis
```

## Quick start

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
const nonces = createRedisNonceStore({ client })
const sessions = createRedisSessionStore({ client })

// SIWE flow — same shape as the in-memory stores, just awaited:
const nonce = await nonces.issue()
// … client signs the SIWE message carrying `nonce` …
if (!(await nonces.consume(nonce))) throw new Error('replay or expired')
const token = await sessions.issue(address, { role: 'member' })
// … later, per request:
const session = await sessions.validate(token) // Session | null
await sessions.revoke(token) // sign-out
```

## Bring your own client

The stores type against a three-command structural surface,
`RedisClientLike` (`set` with `PX`, `get`, `del`) — this package
imports **no Redis library** and has zero runtime dependencies.

| Client | How to pass it |
|---|---|
| node-redis **v4** | Pass the client directly — it matches `RedisClientLike` |
| node-redis **v5** | `fromNodeRedisV5(client)` (v5 moved TTL under `expiration`) |
| ioredis | `fromIoRedis(client)` (positional `'PX', ms` args) |
| anything else | Implement the three methods of `RedisClientLike` |

The one behavioral requirement: `set` must apply `options.PX` as a
**server-side** TTL. The stores treat Redis expiry as the single
source of truth.

## API

```ts
createRedisNonceStore({ client, ttlSeconds?, keyPrefix? }): AsyncNonceStore
```

`ttlSeconds` defaults to 300 (5 minutes), `keyPrefix` to
`'siwe:nonce:'`. `issue()` generates a `viem/siwe` nonce; `consume()`
resolves `true` exactly once per issued, unexpired nonce.

```ts
createRedisSessionStore({ client, ttlMs?, keyPrefix? }): AsyncSessionStore
```

`ttlMs` defaults to 1_800_000 (30 minutes), `keyPrefix` to
`'siwe:session:'`. Claims must be JSON-serializable — they cross the
Redis boundary as `JSON.stringify` output, so hex-encode any bigint
chain values first. A corrupt or non-session payload validates to
`null`, never a crash.

## Relationship to `@valve-tech/siwe-store`

The interfaces (`AsyncNonceStore`, `AsyncSessionStore`, `Session`)
live in `@valve-tech/siwe-store` — it stays the single contract both
in-memory and Redis implementations satisfy. Handler code that only
ever `await`s store results can accept either backend via its
`AnyNonceStore` / `AnySessionStore` unions.

## For AI agents

This package ships an integration skill at
`skills/siwe-store-redis-integration/SKILL.md` (installable via
`npx @valve-tech/agent-skills`), plus an `AGENTS.md` quick reference.

## License

MIT
