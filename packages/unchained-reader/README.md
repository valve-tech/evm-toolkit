# `@valve-tech/unchained-reader`

Browser-safe, **zero-dependency** reader for the [TrueBlocks Unchained
Index](https://trueblocks.io). Resolve the index manifest, fetch bloom
filters and index chunks from any IPFS gateway, and parse the binary
formats client-side into address appearances — **no chifra daemon, no
backend, no API key.**

```bash
npm install @valve-tech/unchained-reader
```

## What it is (and how it differs from `@valve-tech/trueblocks-sdk`)

The Unchained Index is a content-addressed set of *chunks*, each a pair
of IPFS files: a **bloom filter** (fast probabilistic membership) and an
**index** (the authoritative address → appearances table). A **manifest**
lists every chunk's block range and the CIDs of its two files.

- **`@valve-tech/trueblocks-sdk`** is an HTTP client to a **running
  `chifra` daemon** — it asks the daemon about *its own* index.
- **`@valve-tech/unchained-reader`** (this package) fetches the published
  index **directly from IPFS** and parses the binary bloom/chunk formats
  in TypeScript. That parsing logic otherwise exists only in Go inside
  `trueblocks-core`. **No daemon is involved.**

If you run a daemon, use the SDK. If you want a trustless, daemon-less
read straight from the published index (e.g. in a browser), use this.

## Quick start

```ts
import { createFetcher, createUnchainedReader } from '@valve-tech/unchained-reader'

const fetcher = createFetcher({ gatewayUrl: 'https://ipfs.valve.city' })

const reader = createUnchainedReader({
  fetcher,
  manifestCid: 'bafy...the-chain-manifest-cid',
})

const result = await reader.getAppearances('0xabc...', {
  // Bound the work — see "Cost model" below. Omit only for small chains.
  blockRange: { first: 2_748_827n, last: 2_750_000n },
  onProgress: (p) =>
    console.log(`${p.bloomsFetched}/${p.chunksTotal} blooms, ${p.appearancesFound} found`),
})

for (const a of result.appearances) {
  // (blockNumber, transactionIndex) — hydrate with
  // eth_getTransactionByBlockNumberAndIndex against any RPC.
  console.log(a.blockNumber, a.transactionIndex)
}

if (result.failures.length) {
  // Never silently dropped — a partial answer is reported as partial.
  console.warn('incomplete:', result.failures)
}
```

`getAppearances` returns `{ address, appearances, failures, progress }`.
`appearances` is sorted ascending by `(blockNumber, transactionIndex)`.

## Cost model — bound your ranges

This is the honest constraint. Full-history **mainnet** is thousands of
bloom fetches (order of hundreds of MB). So:

- **Always pass `blockRange`** unless the chain's index is small. The
  reader filters chunks to the range *before* fetching, so a tight range
  is cheap. Only chunks whose bloom matches the address trigger an index
  fetch.
- **Wire a cache** (below). CIDs are immutable content addresses, so a
  cached chunk never goes stale — repeat queries over overlapping ranges
  are nearly free.
- Smaller chains (e.g. PulseChain 369 / testnet 943) have far smaller
  indexes; mainnet is the stress case.

## Caching

Pass a `ChunkCache` to the fetcher — `{ get(cid), put(cid, bytes) }`, both
async. Back it with the browser **Cache API**, IndexedDB, or disk:

```ts
const fetcher = createFetcher({
  gatewayUrl: 'https://ipfs.valve.city',
  cache: myChunkCache,
  concurrency: 6,   // max in-flight gateway requests (default 6)
  maxRetries: 1,    // extra attempts after the first failure (default 1)
})
```

## Manifest resolution

Provide **exactly one** of these to `createUnchainedReader`:

| Config | Use |
| --- | --- |
| `manifestCid: string` | Fetch + parse the manifest from the gateway by CID. **Primary path.** |
| `manifest: Manifest` | A manifest you already parsed (e.g. bundled). |
| `resolveManifest: () => Promise<unknown>` | Escape hatch — return raw manifest JSON from anywhere (a well-known URL, your own resolver). The result is parsed and validated. |

**Design decision (recorded per the Phase 1 spec):** the zero-dep core
takes a manifest **CID**, a **pre-parsed manifest**, or an injected
**`resolveManifest`** thunk. A *URL-served* manifest and the
*contract-publication* resolver (the Unchained Index publishes manifest
hashes via a smart contract) are deliberately **not** native config —
they would either add a second fetch path or pull in viem. Wire them
through `resolveManifest` instead (e.g. do an `eth_call` in your app and
return the JSON), so the core never grows a dependency. Explicit CID is
sufficient and is what the example app uses.

Unknown manifest spec versions are **rejected loudly** — no silent
downgrade.

## API

**Pure parsing layer** (functions over `Uint8Array`, no I/O):
`parseManifest`, `parseBloom` / `mightContain`, `parseChunkHeader` /
`appearancesOf`. Use these directly if you do your own fetching.

**Address helpers:** `normalizeAddress`, `addressToBytes`,
`bytesToAddress` (`HexAddress`).

**I/O:** `createFetcher` (`Fetcher`, `FetcherConfig`, `FetchLike`,
`ChunkCache`).

**Orchestrator:** `createUnchainedReader` (`UnchainedReader`,
`ReaderConfig`, `GetAppearancesOptions`, `AppearancesResult`, `Progress`).

All numeric values that participate in math (block numbers, transaction
indices) are `bigint`.

## Browser / mobile safe

Zero runtime dependencies; no Node-only imports. Builds for browser,
edge, Node 18+, and React Native. Bring your own `fetch` if your runtime
lacks a global one (`createFetcher({ fetch })`).

## See it in action

[`examples/unchained-tx-history`](https://github.com/valve-tech/evm-toolkit/tree/main/examples/unchained-tx-history)
is a fully static Vite + React app: type an address, watch its history
stream in, on Ethereum / PulseChain / PulseChain-testnet — pointable at
your own RPC and gateway.

## For AI agents

Machine-readable integration skills ship in this tarball under
`skills/`. Run `npx @valve-tech/agent-skills install` to copy all
installed `@valve-tech/*` skills into `.claude/skills/`, or read them
in place at `node_modules/@valve-tech/unchained-reader/skills/`.

## License

MIT
