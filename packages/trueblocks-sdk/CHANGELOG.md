# Changelog

All notable changes to `@valve-tech/trueblocks-sdk` are documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.10.0] — 2026-05-08

**First OIDC-driven publish for this package**, jumping from the
0.0.1 name-claim. Joins the synchronized release line at v0.10.0.

### Added
- Typed TypeScript HTTP client over the chifra daemon's REST API.
  All 18 OpenAPI endpoints exposed via `createTrueblocksClient(...)`:
  `blocks`, `transactions`, `receipts`, `logs`, `traces`, `when`,
  `state`, `tokens`, `list`, `export`, `monitors`, `names`, `abis`,
  `slurp`, `chunks`, `init`, `config`, `status`.
- 36 narrowed variant accessors on the seven polymorphic endpoints
  whose response is a wide union (4+ types):
  - `client.blocks.{hashes, uncles, traces, uniq, logs, withdrawals, count}`
  - `client.transactions.{traces, uniq, logs}`
  - `client.traces.count`
  - `client.slurp.{appearances, count}`
  - `client.state.call`
  - `client.export.{appearances, receipts, logs, approvals, traces, neighbors, statements, transfers, assets, balances, withdrawals, count, approvalsLogs}`
  - `client.chunks.{manifest, index, blooms, pins, addresses, appearances, stats, count, check}`
- Conditional `VerbFn<P>` typing — endpoints with required query
  parameters (e.g. `/blocks` requires `blocks: string[]`) reject
  no-arg calls at the type level.
- Codegen pipeline: `scripts/codegen.mjs` pulls the upstream OpenAPI
  spec from `TrueBlocks/trueblocks-core` at pinned SHA
  `3205a003af599adf2229408f74afbe6952391883`. `src/generated.ts` is
  fetched on first build (`--if-missing` chained into build, test,
  typecheck), gitignored, and refreshed via `yarn codegen`.
- Browser/mobile-safe runtime — `globalThis.fetch` only, no Node
  imports.
- 100% coverage on the hand-written surface (client, errors, verbs,
  variants).

### Notes
- Licensed MIT, in line with the rest of `@valve-tech/*`. Upstream
  `trueblocks-core` is GPL-3.0-or-later; this package is a
  clean-room TypeScript reimplementation against the public OpenAPI
  spec — no GPL code is incorporated. The clean-room rule (don't
  read the GPL Go SDK source) is preserved in `AGENTS.md` and is
  load-bearing under MIT.
- `state.send()` is **not** exposed: the upstream OpenAPI at the
  pinned SHA describes only `call?: boolean` as a boolean flag on
  the `/state` endpoint, not `send`. The variant will be added when
  the spec gains the flag and codegen picks it up.

## [0.0.1] — 2026-05-08

Manual name-claim publish. Establishes the npm record so a
trusted-publisher binding can be created at npmjs.com; not intended
for consumption.
