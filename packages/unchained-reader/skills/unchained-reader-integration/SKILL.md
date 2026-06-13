---
name: unchained-reader-integration
description: Integrate `@valve-tech/unchained-reader` to read the TrueBlocks Unchained Index directly from IPFS in TypeScript — no chifra daemon, no backend, no API key. Use when the user wants an address's transaction history / appearances trustlessly in the browser (or edge/Node/React Native), asks "how do I read the Unchained Index without a daemon", mentions bloom filters / index chunks / manifest CIDs / `createUnchainedReader` / `getAppearances` / `appearancesOf` / `mightContain` / IPFS-gateway index reads, or wants `(blockNumber, transactionIndex)` appearances to hydrate via `eth_getTransactionByBlockNumberAndIndex`. Also fires on bounding query cost (blockRange, caching blooms/chunks) and on surfacing partial-result failures. Delegate to `trueblocks-sdk-integration` when the user runs a `chifra` daemon and queries it over HTTP (that package is the daemon client; this one parses the published index directly). Skip when the task is daemon-side chifra operation, or plain `eth_getLogs` history with no index involved.
---

# Integrating `@valve-tech/unchained-reader`

Browser-safe, zero-dependency reader for the TrueBlocks Unchained Index.
It fetches the manifest + bloom filters + index chunks from an IPFS
gateway and parses the binary formats client-side into address
appearances. **No daemon.**

## Daemon or no daemon — pick the right package first

- **You run a `chifra` daemon and talk to it over HTTP** → use
  `@valve-tech/trueblocks-sdk` (see `trueblocks-sdk-integration`). It asks
  the daemon about its own index.
- **You want a trustless, daemon-less read straight from the published
  index** (browser, edge, no backend) → this package. It does the binary
  parsing that otherwise lives only in Go inside `trueblocks-core`.

Do not try to make `trueblocks-sdk` fetch from IPFS — it is a daemon
client by design.

## The shape

```ts
import { createFetcher, createUnchainedReader } from '@valve-tech/unchained-reader'

const fetcher = createFetcher({
  gatewayUrl: 'https://ipfs.valve.city',  // any IPFS gateway; no default baked in
  cache: myChunkCache,                     // optional ChunkCache { get, put } — wire Cache API/IndexedDB/disk
})

const reader = createUnchainedReader({ fetcher, manifestCid: 'bafy...' })

const { appearances, failures, progress } = await reader.getAppearances('0x...', {
  blockRange: { first: 0n, last: 3_000_000n },   // BOUND the work (see cost model)
  onProgress: (p) => render(p),                  // chunksTotal/bloomsFetched/hits/chunksFetched/appearancesFound
  signal,                                        // optional AbortSignal
})
```

`appearances` are `{ blockNumber: bigint, transactionIndex: bigint }`,
sorted ascending. Hydrate each with
`eth_getTransactionByBlockNumberAndIndex` against any RPC (e.g. viem's
`getTransaction({ blockNumber, index })`) — that hydration is the
consumer's job; this package only resolves *which* transactions.

## Two invariants you must respect

1. **Bound your ranges + cache.** Full-history mainnet = thousands of
   bloom fetches (hundreds of MB). Always pass `blockRange` unless the
   chain's index is small; the reader filters chunks to the range before
   fetching, and only fetches an index when that chunk's bloom matches.
   CIDs are immutable, so a `cache` makes repeat/overlapping queries
   nearly free. Smaller chains (PulseChain 369 / testnet 943) are cheap;
   mainnet is the stress case.
2. **Check `failures`.** Anything that can't be fetched or parsed lands
   in `result.failures` (`{ range, cid, reason: 'fetch'|'parse', detail }`)
   — a partial answer is never returned as if complete. Surface it; don't
   swallow it.

## Manifest resolution — exactly one

`manifestCid` (primary), a pre-parsed `manifest`, or an injected
`resolveManifest: () => Promise<unknown>` thunk. URL-served and
contract-published manifests go through `resolveManifest` (do the
`eth_call` / fetch in your app and return the JSON) — the zero-dep core
never grows a second fetch path or a viem dependency. Unknown manifest
spec versions are rejected loudly.

## Pure layer (do your own fetching)

`parseManifest`, `parseBloom` / `mightContain`, `parseChunkHeader` /
`appearancesOf` operate on `Uint8Array` with no I/O — use them if you
fetch chunks yourself. `normalizeAddress` / `addressToBytes` /
`bytesToAddress` are the address helpers.

## Where to find more

- `node_modules/@valve-tech/unchained-reader/AGENTS.md` — terse API surface.
- The README's "Cost model" + "Manifest resolution" sections.
- `examples/unchained-tx-history` in the monorepo — a full static app
  wiring this package to a UI (progress, failures, viem hydration, a
  user-overridable RPC).
