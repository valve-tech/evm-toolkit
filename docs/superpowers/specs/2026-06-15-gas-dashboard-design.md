# `examples/gas-dashboard` — gas + chain-source observability example — design spec

**Date:** 2026-06-15
**Status:** approved, ready for implementation plan
**Example set:** 2 of 3 (write-path · gas dashboard · auth+crypto) — see the
companion specs dated 2026-06-15.

## Goal

A self-contained Vite + React + TS static web app that demonstrates the
**chain-observation** half of the toolkit: connect to a chain over public RPC
and watch how gas behaves, per block. Pure read-only observability — no wallet,
no sending — so it complements `tx-write-flight` (which sends) rather than
repeating it.

It covers two packages on the read/observe side and leans hard on
`chain-source`'s capability probe:

- **`@valve-tech/chain-source`** — one poll/subscribe loop + capability
  disclosure
- **`@valve-tech/gas-oracle`** — fee tiers, base-fee trend inputs, block-position

## Non-goals

- No wallet, no transactions of any kind.
- No multi-chain side-by-side compare — one chain at a time with a switcher.
- No historical persistence, alerting, or notifications.
- No charting library — charts are hand-rolled SVG (zero-dep, matching the repo
  ethos and how `unchained-tx-history` hand-rolled its canvas).

## Conventions (inherited from `examples/`)

- Workspace `@valve-tech/example-gas-dashboard`, `"private": true`,
  `@valve-tech/example-` prefix.
- Depends on toolkit siblings by name at the synced `^0.x` line; `viem`,
  `react`, `react-dom` are example-only deps.
- Picked up by root `yarn build` / `lint` / `typecheck` / `test`. Never
  publishes.
- README: what it demonstrates, the package wiring, how to run, the
  capability-degradation behavior, and that no wallet is needed.

## Connection model

- **RPC-only, no wallet.** Reuses `unchained-tx-history`'s chain-selector +
  custom-RPC pattern: pick a known chain or paste an RPC URL; detect `chainId`
  and resolve name/icon from viem.
- **Single chain + switcher.** One `ChainSource` (`createChainSource` over a
  viem `PublicClient`) feeds one `gas-oracle`. Switching chains tears down the
  current source and rebuilds against the new one — demonstrating
  one-ChainSource-per-chain cleanly.
- Updates are driven **per block** via `subscribeBlocks` (WS where the RPC
  exposes it; HTTP polling otherwise — chosen from the capability probe).

## Panels (Layout A — headline tiers + 2×2 grid)

- **Header** — chain switcher, custom-RPC entry, live block number, and
  **capability badges** (HTTP / WS / mempool) read from
  `chain-source.capabilities`.
- **Tiers hero row** — slow / standard / fast / instant with `maxFeePerGas` /
  `maxPriorityFeePerGas`, recomputed each block.
- **2×2 grid:**
  1. **Base-fee trend** — hand-rolled SVG sparkline of base fee over recent
     blocks (from `getFeeHistory` / block headers); shows EIP-1559 dynamics.
  2. **Mempool tip histogram** — SVG bars of pending-tx priority fees from
     `getMempoolSnapshot`, with the four tier cutoffs overlaid so you see where
     each tier sits in the live mempool.
  3. **Block-position estimator** — interactive: type a priority fee → approximate
     position / included-tip percentile in recent blocks, via gas-oracle's
     block-position helper. Connects abstract tiers to "will my tx get in".
  4. **Capability + reducer internals** — the `chain-source` probe result plus a
     "tiers = f(block-included tips, pending tips, base-fee trend)" breakdown of
     the inputs feeding the oracle. The teaching panel.

## Capability-aware degradation (key teaching point)

The dashboard reads `chain-source.capabilities` and **adapts instead of
breaking** — the exact story `chain-source` exists to enable:

- **No mempool support** → the histogram panel shows "this RPC doesn't expose
  the mempool"; the estimator falls back to block-included tips only.
- **No WS** → the source polls over HTTP; a badge reflects it.
- **Method-gated RPC** → affected panels disable with an explanation rather
  than erroring.

## Data flow

`ChainSource` runs one upstream loop → on each new block the app pulls
`getFeeHistory` (trend + tier inputs), `getMempoolSnapshot` (histogram, if
capable), and recomputes gas-oracle tiers. The estimator reacts to user input
against the latest block-tip data. Chain switch → dispose source → build new
source + oracle → panels re-probe capabilities and repaint.

## Error handling & testing

- **RPC/connection failures** surface as a clear banner (bad URL, wrong chain,
  unreachable) — same shape as `unchained-tx-history`.
- **Vitest** covers pure logic only: histogram bucketing, the block-position
  percentile wrapper, fee formatting, and the capability → panel-enabled
  decisions.
- `yarn build` (tsc + vite build) is the CI gate, plus `lint` / `typecheck`.
  Live-chain behavior is documented for a manual run; not unit-tested.

## Aesthetic direction

An "instrument cluster / live monitor" identity — distinct from
`tx-write-flight`'s flight board and `unchained-tx-history`'s graffiti
corridor. Detailed visual pass tracked as the separate cross-cutting theming
task.

## Out of scope / later

- Theming pass (shared visual identity across the three examples) — separate
  task.
- Wallet/sending, multi-chain compare, historical persistence, alerting — see
  Non-goals.
