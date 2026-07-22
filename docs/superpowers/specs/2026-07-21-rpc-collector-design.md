# `@valve-tech/rpc-collector` — design

Date: 2026-07-21
Status: approved (brainstorm), pending implementation plan

## Purpose

Given an EVM `chainId` (or chain name), discover public RPC endpoints from
the chainlist dataset, filter and rank them by privacy tracking + protocol,
and return either:

- a plain, typed array of RPC endpoints, or
- a ready-to-use **viem** transport / **ethers** provider built from that list.

The data core is **zero-runtime** (bundled dataset, no network on import or
collect). Everything that touches the network — live endpoint probing — is
opt-in.

This is a new, standalone package: the **13th package** on the evm-toolkit
synchronized release line. It adds **zero weight** to the other twelve — only
consumers who `yarn add @valve-tech/rpc-collector` pay for the chainlist data.

## Why a standalone package (not a chain-source helper)

Folding RPC discovery into `@valve-tech/chain-source` would make
`chainlist-rpcs` (~349 KB bundled data) a transitive dependency of
`chain-source` and therefore of everything downstream of it (`gas-oracle`,
`tx-tracker`, and any direct consumer) — bloat those packages should not carry.
A standalone package keeps the data dependency isolated to callers who opt in.

## Why `chainlist-rpcs` as the data source

`chainlist-rpcs` is a wrapper around the DefiLlama/chainlist dataset (the same
data chainlist.org is built on). It is the pick because:

- **RPC-centric API** — indexed by chainId, with a filter helper.
- **Ships TS types** (`types.d.ts`).
- **Privacy metadata** — every endpoint carries a `tracking`
  (`none | limited | yes | unspecified | unknown`) rating and an optional
  `isOpenSource` flag. This is the standout value and is **not available from
  any hosted JSON API** — `chainid.network/chains.json` returns bare URL
  strings with no privacy data. The privacy flags live only in DefiLlama's
  `extraRpcs.js` JS module, which `chainlist-rpcs` pre-compiles into JSON.
- **Zero-runtime** — bundled snapshot, no network, deterministic, offline.

### Known tradeoffs (accepted)

- **Single-maintainer, low weekly downloads (~21).** Blast radius is muted: at
  runtime the package only exposes static JSON + filter functions — no network,
  process, or filesystem access. Mitigation: **pin the exact version** and
  review it; the data is trivially replaceable (public chainlist data) if the
  maintainer ever disappears, so there is no real lock-in.
- **Snapshot staleness** (re-published when the maintainer runs it, not
  continuously). Acceptable for endpoint discovery; a future opt-in live source
  is possible behind the same interface without a breaking change.

## Architecture

Four layers, from pure data outward to peer-gated adapters.

### 1. Data layer (zero-runtime)

A thin wrap over pinned `chainlist-rpcs`. It reuses the package's bundled data
and filter functions under the hood but re-exposes results behind our own
small `RpcEndpoint` type, so consumers never import `chainlist-rpcs` directly.
This insulates the single-maintainer dependency and lets the data source be
swapped later without a breaking change to our public API. No network; the only
cost is a module import.

### 2. Collect + filter (pure)

```ts
collectRpcs(options: {
  chainId?: number | string
  chainName?: string
  allowedTracking?: Tracking[]   // default: all except 'yes'? — see Open decisions
  protocol?: 'http' | 'ws' | 'any'  // default: 'http'
  openSourceOnly?: boolean       // default: false
  limit?: number
}): RpcEndpoint[]
```

- **Deterministic ordering**: privacy first (`none` → `limited` →
  `unspecified` / `unknown` → `yes`), then `isOpenSource` (true first), then
  protocol preference.
- **Strips templated junk URLs** — any endpoint containing an unresolved
  `${...}` placeholder (e.g. `https://mainnet.infura.io/v3/${INFURA_API_KEY}`)
  is dropped, since it is unusable without a key.
- Pure and fully testable with fixture data. No network.

```ts
type Tracking = 'none' | 'limited' | 'yes' | 'unspecified' | 'unknown'

interface RpcEndpoint {
  url: string
  protocol: 'http' | 'ws'
  tracking: Tracking
  isOpenSource?: boolean
  chainId: number
}
```

### 3. Adapters (opt-in, peer-gated, separate entry points)

viem and ethers are **optional** peer dependencies (`peerDependenciesMeta`
with `optional: true`). Adapters live in separate entry points so importing the
core `.` never resolves a peer.

- `@valve-tech/rpc-collector/viem`
  ```ts
  toViemTransport(endpoints: RpcEndpoint[], opts?: { mode?: 'fallback' | 'loadBalance' }): Transport
  ```
  - `mode: 'fallback'` (default) → `fallback([http(u) | webSocket(u), ...])`
    (ordered failover).
  - `mode: 'loadBalance'` → `fallback([...], { rank: true })` — viem's built-in
    latency ranker pings and reorders endpoints, distributing toward the
    fastest live ones. (Confirmed available in the in-repo viem 2.48.7.)
  - HTTP urls → `http(url)`, WS urls → `webSocket(url)`.

- `@valve-tech/rpc-collector/ethers`
  ```ts
  toEthersProvider(endpoints: RpcEndpoint[], opts?: { mode?: 'fallback' | 'loadBalance' }): FallbackProvider
  ```
  - `mode: 'fallback'` → `FallbackProvider` with descending priority (list
    order = priority).
  - `mode: 'loadBalance'` → `FallbackProvider` with equal weights (spreads
    load / quorum across endpoints).

### 4. Optional probe (opt-in, async)

```ts
probeEndpoints(endpoints: RpcEndpoint[], opts?: { timeout?: number }): Promise<RpcEndpoint[]>
```

Pings each endpoint (`eth_chainId`), drops or flags dead ones, and reorders
survivors by latency. Library-agnostic — useful for the plain-array and ethers
paths. The viem path already has `mode: 'loadBalance'` (`rank: true`), so
probing is not required there, but the two compose.

## Error handling (no silent downgrade)

Consistent with the toolkit's no-silent-downgrade invariant:

- **Unknown chainId** (not present in the dataset) → throw a typed
  `UnknownChainError` carrying the requested chainId. Do not return `[]`
  ambiguously for "chain doesn't exist" vs "chain exists but filtered empty".
- **Chain known, filters removed everything** → `collectRpcs` returns `[]`
  (a legitimate, explicit result the caller can inspect).
- **Adapters given an empty endpoint list** → throw `EmptyEndpointSetError`
  rather than construct a dead transport/provider.

## Testing

- **Collect + filter**: unit tests over fixture chain data (mock the data
  layer) — ordering, tracking filter, protocol filter, `${...}` stripping,
  `limit`, unknown-chain throw, empty-result return.
- **Adapters**: assert the constructed viem transport / ethers provider
  **config shape** (transport type, url set, rank flag, priorities) without any
  live network. Assert `EmptyEndpointSetError` on empty input.
- **Probe**: mock `fetch` — latency ordering, dead-endpoint drop, timeout.
- **No live-network tests in CI.**

## Package & release

- New workspace `packages/rpc-collector`:
  - `engines.node >= 20`, `type: module`.
  - `exports`: `.` (core), `./viem`, `./ethers`.
  - `dependencies`: `chainlist-rpcs` pinned to an exact version.
  - `peerDependencies`: `viem ^2`, `ethers ^6`, both marked
    `optional: true` in `peerDependenciesMeta`.
  - Standard package files: `README.md`, `AGENTS.md`, `CHANGELOG.md`,
    `LICENSE`, `src/`, `tsconfig.json`, `skills/` if applicable.
- **Synchronized release line (13th package)** — per the `releasing-evm-toolkit`
  skill:
  - version bumped in lockstep with the other twelve,
  - CHANGELOG entry (root + package), promoted out of `[Unreleased]` when the
    synced release is cut,
  - `docs/api` regenerated (`docs:build`),
  - a **Publish step added to `release.yml`** with the manual-first-publish
    dance for a brand-new package,
  - `verify:release-coverage` updated to include the new package so the gate
    covers it.
- **Release is not cut in this work.** Per CLAUDE.md, the package is made
  release-ready and the maintainer triggers the actual release.

## Resolved decisions

1. **Default `allowedTracking` — privacy-first ordering, no silent drop.**
   `collectRpcs` returns *all* endpoints for the chain, *ordered* privacy-first
   (`none` → `limited` → `unspecified`/`unknown` → `yes`). Nothing is silently
   hidden; callers opt into a stricter filter via `allowedTracking`. Honors
   no-silent-downgrade.
2. **Default `protocol` — `'http'`.** The safe default for building a transport;
   `'any'` (mix in WS) and `'ws'` are opt-in.
3. **`skills/` ships in v1** — an agent-skill for `@valve-tech/rpc-collector`
   is part of this work, not deferred.

## Non-goals (v1)

- No live health-checking by default (probe is opt-in).
- No runtime peer detection / auto-sniffing of viem vs ethers.
- No bundled offline fallback beyond what `chainlist-rpcs` already ships.
- No custom round-robin transport beyond viem `fallback` + `rank` / ethers
  `FallbackProvider`.
