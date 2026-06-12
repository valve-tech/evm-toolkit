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
  (`ipfs.valve.city`, the public RPC endpoint) but are trivially
  editable — README documents swapping them.
- Browser Cache API wired into the reader's cache interface so
  re-queries don't refetch blooms/chunks.

## 4. Deployment — `mention.valve.city`

The monorepo stays host-agnostic; deployment is valve-infra work
layered on top. The implementing agent should treat these as
ordered preconditions and verify each (don't assume):

1. **DNS**: `mention.valve.city` — no record exists (probed
   2026-06-12). Note `ipfs.valve.city` and `rpc.valve.city` both
   resolve to Cloudflare-proxied IPs; follow the same Cloudflare
   pattern for `mention.valve.city` (proxied record → valve-prod
   origin at 88.99.192.187) rather than a bare A record, unless the
   maintainer says otherwise.
2. **Caddy site block** on valve-prod: static `root` +
   `file_server` + `try_files {path} /index.html` (SPA fallback)
   serving an uploaded `dist/`. ⚠️ Any Caddyfile edit follows the
   `valve-caddy-config` skill discipline (render script, validate,
   careful reload) — this is a **redeploy of Caddy config** on a
   production box that fronts customer RPC traffic.
3. **CORS on `ipfs.valve.city`**: ✅ ALREADY SATISFIED (probed
   2026-06-12): the gateway returns
   `access-control-allow-origin: *` with GET/HEAD/OPTIONS allowed.
   No kubo or Caddy change needed. Re-probe once during final
   verification:
   `curl -sI -H "Origin: https://mention.valve.city" https://ipfs.valve.city/ipfs/<cid>`.
4. **RPC endpoint auth — OPEN DECISION (blocks tx hydration)**.
   Probed 2026-06-12: `rpc.valve.city` CORS is already correct
   (origin reflected, POST allowed), but an anonymous
   `eth_blockNumber` POST returns **401 — the endpoint requires an
   API key**. A static frontend cannot hold a secret. Analysis
   shared with the maintainer:
   - An Origin-restricted proxy holding an unlimited key is NOT
     actually restricted — Origin headers are spoofable by any
     non-browser client, so it degenerates into an unlimited
     anonymous endpoint unless rate-limited, at which point it is
     an anon tier with extra steps and a leakable key.
   - **Recommended: anonymous tier in the existing auth layer** —
     per-chain public route that skips key auth, per-IP rate limit,
     read-only method allowlist (no `eth_sendRawTransaction`).
     Needed for all three chains (1/369/943).
   - Maintainer is deciding; **confirm the final choice and the
     exact per-chain RPC URLs before wiring the example's
     `config.ts`**. Do not bake in an unlimited key under any
     option.
5. **App deploy**: `yarn workspace @valve-tech/example-unchained-tx-history build` then
   rsync `dist/` to the webroot. Document the exact rsync target in
   the example README once created.

Redeploy summary (updated after 2026-06-12 probes): step 2 (the new
site block) is the only Caddy change still needed — steps 3–4 need
no CORS work. Step 4 needs a key/tier decision from the maintainer,
not a redeploy (unless option (b) is chosen, which is fleet config).
Step 5 is file copy only, no service restart.

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

## Acceptance

- [ ] `yarn verify:clean` green at repo root (all 10 packages +
      example workspace).
- [ ] `yarn verify:release-coverage` green (release.yml has the new
      Publish step).
- [ ] TS parser output matches `chifra list` for the fixture
      address/range (documented in fixtures).
- [ ] Example runs locally against `ipfs.valve.city` + public RPC
      and renders history for a known address.
- [ ] `https://mention.valve.city` serves the app; a fresh browser
      session can load the tx history of an arbitrary address on
      each of the three chains (1 / 369 / 943) with visible
      progress and no console CORS errors.

## Out of scope / later phases (each gets its own spec)

- **Phase 2 — skills discoverability**: an `npx`-able installer
  (probable home: new `@valve-tech/agent-skills` package) that scans
  `node_modules/@valve-tech/*/skills/` and links them into a
  consumer's `.claude/skills/`; "For AI agents" pointers in every
  README; a cross-package `building-apps-with-evm-toolkit` skill
  that references `examples/`.
- **Phase 3 — quality pass** over the 9 existing per-package
  SKILL.md files.
- Contract-based manifest resolution if deferred during Phase 1.
- IPFS-hosting the app itself (DNSLink) — aesthetic flourish, later.
