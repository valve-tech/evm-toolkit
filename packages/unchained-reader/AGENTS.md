# AGENTS.md

Terse reference for AI agents (Claude Code, Cursor, Aider) integrating
`@valve-tech/unchained-reader`. Full README is for humans; this file is
the fast surface.

## What this package does

Browser-safe, **zero-dependency** reader for the TrueBlocks Unchained
Index. Fetches the manifest + bloom filters + index chunks from an IPFS
gateway and parses the binary formats client-side into address
appearances `(blockNumber, transactionIndex)`. **No chifra daemon, no
backend, no API key.**

Contrast with `@valve-tech/trueblocks-sdk`: that is an HTTP client to a
**running daemon**; this reads the **published index directly from
IPFS**. Daemon-less index reads → here. Daemon queries → the SDK.

## Public API

```ts
import {
  createFetcher,          // ({ gatewayUrl, fetch?, cache?, concurrency?, maxRetries? }) => Fetcher
  createUnchainedReader,  // ({ fetcher, manifestCid | manifest | resolveManifest }) => UnchainedReader
  // pure layer (Uint8Array in, no I/O):
  parseManifest, parseBloom, mightContain, parseChunkHeader, appearancesOf,
  // address helpers:
  normalizeAddress, addressToBytes, bytesToAddress,
} from '@valve-tech/unchained-reader'

const reader = createUnchainedReader({
  fetcher: createFetcher({ gatewayUrl: 'https://ipfs.valve.city' }),
  manifestCid: 'bafy...',
})

const { appearances, failures, progress } = await reader.getAppearances('0x...', {
  blockRange: { first: 0n, last: 3_000_000n },   // bound the work
  onProgress: (p) => {/* chunksTotal, bloomsFetched, hits, chunksFetched, appearancesFound */},
  signal,                                          // optional AbortSignal
})
```

## Shapes

- `Appearance` = `{ blockNumber: bigint, transactionIndex: bigint }` —
  feed to `eth_getTransactionByBlockNumberAndIndex` to hydrate.
- `AppearancesResult` = `{ address, appearances[], failures[], progress }`.
  `appearances` sorted ascending by `(blockNumber, transactionIndex)`.
- `ChunkFailure` = `{ range, cid, reason: 'fetch'|'parse', detail }`.
- `BlockRange` = `{ first: bigint, last: bigint }` (inclusive).
- `ChunkCache` = `{ get(cid): Promise<Uint8Array|undefined>, put(cid, bytes): Promise<void> }`.

## Invariants (do not break)

- **Zero runtime deps; browser/mobile safe.** No Node-only imports. Bring
  your own `fetch` via `createFetcher({ fetch })` if no global exists.
- **No silent downgrade.** Anything that fails to fetch/parse lands in
  `result.failures` (range + CID + reason) — a partial answer is never
  returned as if complete. Always check `failures`.
- **Bound your ranges.** Full-history mainnet = thousands of bloom
  fetches. Pass `blockRange`; wire a `cache` (CIDs are immutable).
- **Manifest CID/manifest/resolveManifest** — exactly one. URL- and
  contract-based resolution go through `resolveManifest` (no viem in the
  core).
- **bigint** for block numbers / tx indices.

## Integration skills

This package bundles its integration skill under `skills/`. Run
`npx @valve-tech/agent-skills install` to copy all installed
`@valve-tech/*` skills into `.claude/skills/`, or read this one in
place at `node_modules/@valve-tech/unchained-reader/skills/`.
