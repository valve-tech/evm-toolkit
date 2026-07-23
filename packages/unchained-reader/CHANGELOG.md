# Changelog

All notable changes to `@valve-tech/unchained-reader` are documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.22.0] — 2026-07-23

### Notes

- Synchronized release — no changes to this package. Bumped in
  lockstep with the rest of the toolkit.

## [0.21.0] — 2026-07-15

### Changed

- Declared `engines.node` as `>=20`. The packages are CI-tested on Node
  20, 22, and 24; this makes the supported range explicit for consumers.

## [0.20.0] — 2026-06-26

### Notes

- Synchronized release — no changes to this package. Bumped in
  lockstep with the rest of the toolkit.

## [0.19.0] — 2026-06-21

### Added

- Initial release. A browser-safe, zero-runtime-dependency reader for the
  TrueBlocks Unchained Index — resolves the manifest, fetches bloom
  filters and index chunks from any IPFS gateway, and parses the binary
  bloom/chunk formats client-side into address appearances
  `(blockNumber, transactionIndex)`. No `chifra` daemon, no backend, no
  API key.
  - Pure parsing layer over `Uint8Array` (no I/O): `parseManifest`,
    `parseBloom` / `mightContain`, `parseChunkHeader` / `appearancesOf`.
    Binary formats vendored from the Unchained Index specification and
    cross-checked against real published bloom/index fixtures (see
    `src/__fixtures__/`).
  - I/O layer: `createFetcher` — configurable IPFS `gatewayUrl`, bounded
    concurrency, retry-once policy, an injectable `ChunkCache`
    (`get`/`put`) for the browser Cache API / IndexedDB / disk, an
    injectable `fetch` for runtimes without a global, and a separate
    priority pool (`priorityConcurrency`, used via `fetchCid(cid, { priority })`)
    so large index-chunk fetches from bloom hits download in their own lane —
    appearances stream as found, and the big chunk downloads never stall the
    ongoing bloom scan (nor vice versa).
  - Orchestrator: `createUnchainedReader(config).getAppearances(address,
    opts)` — manifest → range-filtered chunks → lazy concurrent bloom
    fetch → index fetch on bloom hit → sorted appearances. First-class
    progress (`onProgress`), streaming results (`onAppearances`, fired the
    moment each chunk yields appearances so a UI can render/hydrate before
    the full scan finishes), and a `failures` array (no silent downgrade —
    a partial answer is reported as partial). `AbortSignal` support.
  - Manifest resolution: `manifestCid` (primary), pre-parsed `manifest`,
    or an injected `resolveManifest` thunk for URL/contract-published
    manifests — the zero-dep core never grows a second fetch path or a
    viem dependency. Contract-publication resolution deferred to the
    consumer per the Phase 1 design.
  - Address helpers: `normalizeAddress`, `addressToBytes`,
    `bytesToAddress`.
- Pairs with `@valve-tech/trueblocks-sdk` (daemon client): this package
  reads the published index directly; the SDK talks to a running daemon.
- Joins the toolkit's synchronized release line; its first publish is a
  manual OIDC trusted-publisher bootstrap (see
  `.claude/skills/releasing-evm-toolkit/SKILL.md`).
