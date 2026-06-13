# Unchained tx-history example + `@valve-tech/unchained-reader` — design spec

**Date:** 2026-06-12
**Status:** Approved by maintainer; ready for implementation planning
**Phase:** 1 of 3 (see "Out of scope / later phases" at the end)

## Goal

Prove — with a public, fully static web app — that the TrueBlocks
Unchained Index is trustlessly consumable from a browser with
nothing but an RPC URL and an IPFS gateway. No chifra daemon, no
backend, no API key.

Deliverables:

1. A root `examples/` convention for whole runnable apps in this
   monorepo.
2. A new published package, `@valve-tech/unchained-reader` — a
   browser-safe library that resolves the Unchained Index manifest,
   fetches bloom filters and index chunks from an IPFS gateway, and
   parses them client-side into address appearances.
3. `examples/unchained-tx-history` — a Vite + React + TS static app:
   type any address, watch its transaction history stream in.
4. Deployment of that app to `https://mention.valve.city`.

## Why this is net-new (context for the implementing agent)

`@valve-tech/trueblocks-sdk` is an HTTP client to a **running chifra
daemon**. Its `client.chunks.manifest()` / `.blooms()` / `.index()`
methods ask the daemon about *its own local index* and return
metadata (ranges, CIDs). Nothing in that package — or anywhere in
JS upstream — fetches from IPFS or parses the binary bloom/chunk
formats. That parsing logic exists only in Go inside
`TrueBlocks/trueblocks-core`. This package implements it in TS.

Do NOT bolt this onto `trueblocks-sdk` — keeping the daemon-client
identity of that package clean was an explicit design decision.

---

## 1. `examples/` convention

- Root `examples/` directory. Each example is a **self-contained
  app** that is also a yarn workspace with `"private": true`.
- Add `"examples/*"` to the root `package.json` `workspaces` array.
- Examples depend on toolkit siblings **by package name** (e.g.
  `"@valve-tech/unchained-reader": "workspace:^"` is NOT used —
  use a normal semver range like `"^0.19.0"` so the `package.json`
  works verbatim when a user copies the example out of the repo;
  yarn workspaces resolves a matching semver range to the local
  workspace during in-repo dev). If the in-repo resolution proves
  flaky, fall back to `workspace:^` and document the one-line edit
  in the example README — but try semver-range-resolution first.
- CI: the root `yarn lint` / `yarn typecheck` / `yarn build` /
  `yarn test` foreach loops pick the example workspaces up
  automatically. That is intended — examples must not rot.
- `yarn verify:release-coverage` ignores them automatically (it
  only checks non-private packages). Examples never publish.
- Each example README must include: what it demonstrates, how to run
  it (`yarn dev`), and a "copying this out of the repo" section.
- Distinction from per-package `examples/` dirs (e.g.
  `packages/gas-oracle/examples/`): those remain numbered
  single-file snippet scripts; root `examples/` is for whole apps.

## 2. `@valve-tech/unchained-reader` — the 10th package

### Identity

Browser-safe TS library for reading the Unchained Index directly:
manifest → blooms → chunks → appearances. Zero runtime
dependencies. Works in browser, edge, Node 18+, React Native (all
toolkit invariants apply — see
`.claude/skills/contributing-to-evm-toolkit/SKILL.md`).

Package directory shape mirrors the other nine: `src/` with
colocated `*.test.ts`, `skills/unchained-reader-integration/SKILL.md`,
`AGENTS.md`, `README.md`, `CHANGELOG.md`, `LICENSE`, `.npmignore`,
`files` allowlist including `skills`.

### Layering (toolkit primitive-layer invariant)

**Pure parsing layer — functions over `Uint8Array`, no I/O:**

- `manifest.ts` — decode/validate the manifest JSON (chunk list:
  range, bloom CID + size, index CID + size; chain; spec version).
  Reject unknown spec versions loudly (no silent downgrade).
- `bloom.ts` — parse the bloom file format; membership test
  `mightContain(bloom, address): boolean`.
- `chunk.ts` — parse the index chunk format (header, address table,
  appearance table); extract appearances for an address:
  `{ blockNumber: bigint, transactionIndex: bigint }[]`.

**Binary format is the load-bearing research task.** Vendor the
format from the Unchained Index specification
(`TrueBlocks/trueblocks-core` — the spec document plus the Go
reader implementation in that repo are the sources of truth; do not
trust memory or third-party blog posts for offsets/magic numbers).
Verify by generating fixtures with a real chifra installation: take
actual published bloom + chunk files for a known range, assert the
TS parser yields byte-identical appearance sets to
`chifra list <addr>` output for addresses in that range. Vendored
binary fixtures live in `src/__fixtures__/` (small chunks only).

**I/O layer:**

- `fetcher.ts` — IPFS gateway fetch: configurable gateway base URL
  (no default hardcoded to valve infra — the *example* passes
  `https://ipfs.valve.city`), bounded concurrency, retry-once
  policy, and an injectable cache interface
  (`get(cid)` / `put(cid, bytes)`) so the example can wire the
  browser Cache API and Node consumers can wire disk.

**Orchestrator:**

- `reader.ts` — `createUnchainedReader(config)` returning
  `getAppearances(address, opts)`:
  - resolve manifest → filter chunks by `opts.blockRange` →
    fetch blooms (lazy, concurrent) → on bloom hit fetch + parse
    chunk → emit appearances.
  - **Progress is first-class**: `opts.onProgress` callback with
    counts (chunks total / blooms fetched / hits / chunks fetched /
    appearances found). This is a long multi-fetch operation; a UI
    must be able to render it.
  - **No silent downgrade**: the result carries a `failures` array
    (chunk range + CID + reason) for anything that could not be
    fetched or parsed. Never silently return a partial answer that
    looks complete.

**Manifest resolution** (config union, pick exactly one):

- `{ manifestCid: string }` — explicit CID (primary path; this is
  what the example uses).
- `{ manifestUrl: string }` — well-known URL serving the manifest
  JSON.
- A contract-publication resolver (the Unchained Index publishes
  manifest hashes via a smart contract) MAY be added behind an
  injected `ethCall` function — do NOT add viem as a dependency for
  it. If the contract-read mechanism turns out to require log
  scanning rather than a simple `eth_call`, defer it: explicit
  CID/URL is sufficient for Phase 1. Decide during implementation
  after reading the spec; record the decision in the package README.

### Honest constraint — bounded ranges by default

Full-history mainnet means thousands of bloom fetches (order of
hundreds of MB total). The API therefore: (a) requires/strongly
defaults `blockRange` bounding, (b) documents the cost model in
README + skill, (c) relies on the cache interface to make repeat
queries cheap. The example defaults to a bounded recent range with
an explicit "fetch full history" opt-in. Valve's own chains
(369 / 943) have far smaller indexes; mainnet is the stress case.

### Style invariants (same as every package)

bigint for block numbers and anything mathematical; const-namespace
pattern for string unions (e.g. failure reasons); `.js` import
extensions; JSDoc on every export; no `any`; one responsibility per
file; behavior-driven colocated tests.

### Release coupling

- Joins the synced release line: next release bumps all **ten**
  packages to the same version.
- **Manual first publish required** (OIDC trusted-publisher dance) +
  add a `Publish @valve-tech/unchained-reader` step to
  `.github/workflows/release.yml` — follow
  `.claude/skills/releasing-evm-toolkit/SKILL.md` exactly.
  `yarn verify:release-coverage` will fail (by design) until the
  workflow step exists.
- Ships `skills/unchained-reader-integration/SKILL.md` + `AGENTS.md`
  in the tarball like the other nine packages. Write the skill with
  the same description discipline as the existing nine (trigger
  phrases, delegation boundaries vs `trueblocks-sdk-integration`:
  daemon-less index reads → this package; daemon queries → that one).

## 3. `examples/unchained-tx-history`

- Workspace package name: `@valve-tech/example-unchained-tx-history`
  (`"private": true`; the `@valve-tech/example-` prefix keeps example
  workspaces visually distinct in foreach output and is the naming
  convention for all future `examples/*`).
- Vite + React + TS, fully static output (`yarn build` → `dist/`),
  no server code, no env secrets (any config baked at build time is
  public by definition — RPC URL + gateway URL + manifest CID are
  all public values).
- UX: address input → appearances stream into a table with a live
  progress indicator (driven by `onProgress`) → each appearance
  hydrated to tx details (`getTransaction` via viem `http` transport
  against the configured RPC) → sortable table (block, hash,
  from/to, value). Failures surface in the UI (failed chunk ranges
  shown, not hidden).
- viem is a dependency of the **example only**, not of
  unchained-reader.
- **Multichain is a hard requirement**: the UI has a chain selector
  covering Ethereum mainnet (1), PulseChain (369), and PulseChain
  testnet v4 (943). Config is a per-chain map:
  `{ chainId, label, rpcUrl, manifestCid (or manifestUrl), defaultBlockRange }`.
  The manifest for 369/943 comes from valve's own chifra publishing
  (pinned at `ipfs.valve.city`); mainnet can use the upstream
  TrueBlocks-published manifest or valve's pin — implementer
  confirms with the maintainer which CIDs to bake in.
- Config (build-time constants or a small `config.ts`): per-chain
  map above + IPFS gateway base. Defaults point at valve infra
  (`ipfs.valve.city`, the public rate-limited RPC endpoints) but
  are trivially editable — README documents swapping them.
- **User-overridable RPC endpoints in the UI** (hard requirement):
  a settings affordance where the end user pastes their own RPC URL
  per chain (and optionally their own IPFS gateway), persisted in
  `localStorage`, with a reset-to-defaults action. This is the
  headline property of the demo: anyone can point it at their own
  node and cut valve out entirely. The UI should surface which
  endpoint is in use.
- Browser Cache API wired into the reader's cache interface so
  re-queries don't refetch blooms/chunks.

## 4. Deployment — `mention.valve.city`

The monorepo stays host-agnostic; deployment is valve-infra work
layered on top. The implementing agent should treat these as
ordered preconditions and verify each (don't assume):

1. **DNS**: ✅ DONE (2026-06-12, maintainer-added via CF
   dashboard). `mention.valve.city` resolves to Cloudflare-proxied
   IPs; verified end-to-end: `https://mention.valve.city/` → 200
   (placeholder page), deep path → 200 (SPA fallback), plain HTTP
   → 301 to https. The site is fully live — step 5's rsync is the
   only thing between the placeholder and the real app.
2. **Caddy site block** on valve-prod: ✅ DONE (2026-06-12).
   Shipped via the monorepo `caddy-deploy` plan (monorepo commit
   `72702cb`): static root `/var/www/mention`,
   `try_files {path} /index.html` SPA fallback, gzip/zstd, shared
   `*.valve.city` origin cert, plus membership in the http→https
   redirect block. A placeholder `index.html` is serving.
   Post-reload smoke (within 30s, via `--resolve` since DNS is
   pending): mention 200, deep-path SPA fallback 200, valve.city
   200, rpc real-key 200, rpc bogus-key 401 (not 500).
3. **CORS on `ipfs.valve.city`**: ✅ ALREADY SATISFIED (probed
   2026-06-12): the gateway returns
   `access-control-allow-origin: *` with GET/HEAD/OPTIONS allowed.
   No kubo or Caddy change needed. Re-probe once during final
   verification:
   `curl -sI -H "Origin: https://mention.valve.city" https://ipfs.valve.city/ipfs/<cid>`.
4. **RPC endpoints — DECIDED (2026-06-12): rate-limited public
   tier, direct JSON-RPC.** Probed: `rpc.valve.city` CORS is
   already correct (origin reflected, POST allowed); anonymous
   POSTs 401 because the fleet requires a key. The valve monorepo
   (the fleet's auth layer — separate repo, NOT this one) already
   supports a rate-limited public/demo tier; ✅ the per-chain URLs
   are now live and verified (2026-06-12) — wire these into
   `config.ts`:
   - chain 1:   `https://rpc.valve.city/v1/vk_demo/evm/1`
   - chain 369: `https://rpc.valve.city/v1/vk_demo/evm/369`
   - chain 943: `https://rpc.valve.city/v1/vk_demo/evm/943`
   (equivalent per-chain-subdomain form also works:
   `https://evm-{chainId}-rpc.valve.city/v1/vk_demo`.)
   `vk_demo` is valve's *deliberately public* demo key — per-IP
   rate-limited (5 req/s, 5k/day, verified live: burst of 12 →
    5×200 then 429s), CU-capped, and as of monorepo `8ce684b` it
   denies `eth_sendRawTransaction`/`eth_sendTransaction` at the
   relay (verified: 403 "Method not allowed"). Baking it into the
   static app is safe and intended; it is not a secret. The
   hydration method (`eth_getTransactionByBlockNumberAndIndex`)
   is verified working through it on all three chains.
   Hydration is plain JSON-RPC (viem) — appearances are
   `(blockNumber, txIndex)` pairs, so the hydration call is
   `eth_getTransactionByBlockNumberAndIndex` plus a block-timestamp
   read. Rejected alternatives (recorded so they aren't
   re-proposed): an Origin-restricted proxy holding an unlimited
   key (Origin is spoofable — it degenerates to an unlimited open
   endpoint), and a purpose-built REST hydration API (contained and
   cacheable, but it breaks the headline win: with direct JSON-RPC,
   a user can replace valve's RPC entirely and run trustless).
   Do not bake an unlimited key into the frontend under any
   circumstances.
5. **App deploy**: `yarn workspace @valve-tech/example-unchained-tx-history build` then
   rsync `dist/` to the webroot. Exact target (webroot live since
   2026-06-12, currently holding a placeholder `index.html` —
   overwrite it):
   `rsync -av --delete dist/ root@88.99.192.187:/var/www/mention/`
   ⚠️ valve-prod sshd listens on port **2222** (`rsync -e "ssh -p 2222"`);
   auth via the `valve-hetzner` key
   (op://valve/hetzner valve load balancer/private key). Record
   this in the example README once created.

Redeploy summary: ✅ COMPLETE (2026-06-12). All steps done — the app is
live at <https://mention.valve.city> (dist rsynced to
`/var/www/mention` via the port-2222 / `valve-hetzner` path above).

One infra finding worth recording: valve fully pins its own chains
(369 / 943) on `ipfs.valve.city`, but **not every mainnet chunk is
pinned** (mainnet's index is TrueBlocks-published). An unpinned CID
makes the gateway hang on a DHT lookup, so the reader gained a
per-request **fetch timeout** (`createFetcher({ timeoutMs })`,
default 20s): a timed-out fetch becomes a surfaced `failures` entry
rather than an infinite stall. Mainnet therefore renders an honest
*partial* result with a "N chunks could not be read" warning until
its chunks are pinned; 369 / 943 are complete. To make mainnet
fully complete, pin the TrueBlocks mainnet chunk set on
`ipfs.valve.city`.

## Testing

- Pure layer: fixture-driven unit tests against vendored real chunk
  bytes; cross-checked once against `chifra list` ground truth
  (record the ground-truth command + output in the test fixture
  README).
- Fetcher: unit tests with injected fake `fetch` (failure paths,
  concurrency cap, cache hit/miss).
- Orchestrator: integration-style test with fixture manifest + fake
  fetcher; asserts progress callbacks, failure surfacing, range
  filtering.
- Example: `yarn build` in CI is the gate; manual end-to-end run
  against real infra before deploy (per contributing skill: don't
  claim an example works without running it).

## Acceptance — ✅ MET (2026-06-12)

- [x] `yarn verify:clean` green at repo root (all 11 publishable
      packages + the example workspace; build / lint / typecheck /
      test / persisted-types all pass).
- [x] `yarn verify:release-coverage` green — `release.yml` has the
      `@valve-tech/unchained-reader` Publish step (covers all 11).
- [x] TS parser output verified against ground truth. NOTE: cross-checked
      against the **live chain** (the decoded appearances of
      `0x0000908102040217905550828260010160026101` on 943 —
      `(2749518,1)` and `(2749585,4)` — are real txs, address present
      in calldata) rather than `chifra list` (no local chifra
      install). On-chain reality is an equal-or-stronger oracle; the
      fixture provenance + CIDs are recorded in the package.
- [x] Example runs against `ipfs.valve.city` + the public RPC and
      renders history — verified end-to-end in a real browser (943
      sample → 4 hydrated txs, zero CORS/console errors).
- [x] `https://mention.valve.city` serves the app; a fresh browser
      session loads history on all three chains with visible progress
      and **zero console CORS errors** — verified live: 943 → 4 rows,
      369 → 15 rows, mainnet → honest partial result with surfaced
      `failures` (its chunks aren't all pinned yet — see the redeploy
      summary above).

## Out of scope / later phases (each gets its own spec)

- **Phase 2 — skills discoverability**: now specced separately at
  `2026-06-12-agent-skills-design.md` (`@valve-tech/agent-skills`
  installer CLI + cross-package `building-apps-with-evm-toolkit`
  skill + "For AI agents" README pointers). Independent of this
  spec — implementable in either order or in parallel.
- **Phase 3 — quality pass** over the 9 existing per-package
  SKILL.md files.
- Contract-based manifest resolution if deferred during Phase 1.
- IPFS-hosting the app itself (DNSLink) — aesthetic flourish, later.
