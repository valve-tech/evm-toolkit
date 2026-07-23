---
name: rpc-collector
description: Use when choosing, discovering, or wiring public EVM RPC endpoints — finding RPCs for a chainId, filtering them by privacy tracking, or building a viem transport / ethers provider with failover instead of hardcoding a single RPC URL. Covers @valve-tech/rpc-collector's collectRpcs, probeEndpoints, toViemTransport, and toEthersProvider.
---

# Collecting EVM RPC endpoints

`@valve-tech/rpc-collector` turns "which RPC should I use?" into data. It ships
the DefiLlama/chainlist dataset compiled into the package — no runtime
dependencies, no network call to discover endpoints.

## Get endpoints for a chain

```ts
import { collectRpcs } from '@valve-tech/rpc-collector'

const endpoints = collectRpcs({ chainId: 1 })
```

Results are ordered privacy-first: `none` → `limited` → `unspecified` →
`unknown` → `yes`. **Nothing is filtered out by default** — a tracked endpoint
is still returned, just last. Filter explicitly when it matters:

```ts
collectRpcs({ chainId: 1, allowedTracking: ['none'], limit: 5 })
collectRpcs({ chainName: 'base', protocol: 'ws' })
```

`protocol` defaults to `'http'`. Use `'ws'` or `'any'` when you need sockets.

Unknown chains throw `UnknownChainError` — they never come back as an empty
array, so a typo cannot look like "this chain has no RPCs".

## Wire it into a client

Adapters live in subpath exports so the core never pulls a peer dependency.

```ts
import { toViemTransport } from '@valve-tech/rpc-collector/viem'

const transport = toViemTransport(endpoints, { mode: 'loadBalance' })
```

```ts
import { toEthersProvider } from '@valve-tech/rpc-collector/ethers'

const provider = toEthersProvider(endpoints, { mode: 'fallback' })
```

- `'fallback'` — try in order, rotate on failure.
- `'loadBalance'` — spread traffic; viem re-ranks by latency, ethers gives
  every endpoint equal priority.

Both throw `EmptyEndpointSetError` on an empty list rather than hand back a
transport that fails every call. If you filtered aggressively, check the array
is non-empty first.

## Check liveness before committing

```ts
import { probeEndpoints } from '@valve-tech/rpc-collector'

const live = await probeEndpoints(endpoints, { timeoutMs: 2000 })
```

This is the only part of the package that touches the network. It drops
endpoints that fail or answer for the wrong chainId, and sorts by latency.
With viem you usually do not need it — `mode: 'loadBalance'` already ranks.

## Common mistakes

- **Assuming the default filters out trackers.** It does not; it orders them
  last. Pass `allowedTracking` if you need a hard filter.
- **Importing an adapter from the root export.** `toViemTransport` is at
  `@valve-tech/rpc-collector/viem`, not the package root.
- **Editing `src/data.generated.ts`.** It is generated; re-run the vendor
  refresh and codegen scripts instead.
