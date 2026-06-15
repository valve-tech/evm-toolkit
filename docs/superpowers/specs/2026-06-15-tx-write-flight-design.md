# `examples/tx-write-flight` — write-path dapp example — design spec

**Date:** 2026-06-15
**Status:** approved, ready for implementation plan
**Example set:** 1 of 3 (write-path · gas dashboard · auth+crypto) — see the
companion specs dated 2026-06-15.

## Goal

A self-contained Vite + React + TS static web app that demonstrates the
**write half** of the evm-toolkit: pricing a transaction, sending it with
lifecycle hooks, tracking it to a terminal state, rendering its progress, and
classifying failures — plus the stuck-tx replacement flow. It is the natural
companion to `unchained-tx-history` (which demos the read half).

It covers the six write-side packages that currently have **no runnable app
example**, and embodies two of the three recipes in the
`building-apps-with-evm-toolkit` skill:

- **`@valve-tech/chain-source`** — one poll loop, fanned out (Recipe 2)
- **`@valve-tech/gas-oracle`** — fee tiers + replacement-bump helpers
- **`@valve-tech/tx-tracker`** — per-tx state machine + replacement
- **`@valve-tech/wallet-adapter`** — `WalletAdapter` + `sendTransactionWithHooks`
- **`@valve-tech/tx-flight-react`** — the in-flight transaction strip
- **`@valve-tech/viem-errors`** — cause-chain error classification

## Non-goals

- No backend, no server relayer (the relayer `WalletAdapter` is a package-level
  example, not this app).
- No ERC-20 approve flows, no batching, no ERC-4337 — the three actions below
  exercise every lifecycle path without them.
- No multi-wallet / WalletConnect — injected EIP-1193 only.
- No historical transaction list — that is `unchained-tx-history`'s job. This
  app shows only the transactions it originates.

## Conventions (inherited from `examples/`)

- Workspace package `@valve-tech/example-tx-write-flight`, `"private": true`,
  `@valve-tech/example-` name prefix.
- Depends on toolkit siblings **by package name** at the current synced
  `^0.x` line; `viem`, `react`, `react-dom` are dependencies of the example
  only.
- Picked up automatically by the root `yarn build` / `lint` / `typecheck` /
  `test` foreach loops. Examples never publish (`private: true`).
- README must include: what it demonstrates, the package wiring, how to run,
  which actions need WETH, and the testnet/mainnet caution.

## Anchor actions (permissionless — no contract to deploy)

A small action selector. Each action drives a different lifecycle path:

1. **Native send** — plain value transfer to a typed recipient (or self).
   Works on any chain. Exercises the happy path + replacement.
2. **Wrap ETH → WETH** — `deposit()` (payable) on the chain's canonical WETH.
   The contract-call happy path.
3. **Unwrap WETH → ETH** — `withdraw(amount)` on canonical WETH. Overdrawing
   reverts → the `ContractRevertedError` / `extractContractErrorName` demo.

Wrap/Unwrap are gated by a small **chain → WETH address registry**; on chains
not in the registry those two actions are disabled (native send still works).

## Chains

The app follows **whatever chain the connected wallet is on**, mainnets
included, and shows that chain's real gas tiers. Because real funds are
possible, the app keeps default amounts tiny and always shows a
**gas-oracle cost preview** (resolved fee + total) on an explicit *Review &
send* step before signing. The README carries a plain caution.

## Wallet connection

A **thin injected EIP-1193 `WalletAdapter`** built over `window.ethereum`
(MetaMask / Rabby / etc.). Minimal dependencies, and it shows readers exactly
how to implement the `WalletAdapter` interface against any EIP-1193 provider —
the core teaching point. No project IDs, no provider config.

## Architecture & data flow

### Shared substrate (Recipe 2)
`createChainSource(publicClient)` is created **once** and passed to **both**
`gas-oracle` and `tx-tracker`. One RPC poll cycle fans out to: block
subscription (header + live block number), `getReceipt`, `getFeeHistory`
(feeds the oracle), and capability disclosure. The example deliberately
demonstrates the "never stand up two poll loops against one RPC" rule — the
oracle and tracker are siblings over one source, not layered.

### Send path (Recipe 1)
1. User picks an action + a gas tier. `gas-oracle` supplies the tier's
   `maxFeePerGas` / `maxPriorityFeePerGas`; those become the request's fee
   fields, and the cost preview is rendered from them.
2. *Review & send* → `tx-flight-react`'s `useTxFlight().addWithWalletAdapter`
   runs the send+track flow: `wallet-adapter.sendTransactionWithHooks` drives
   the `WriteHookParams` lifecycle (awaiting-signature → hash →
   confirmed/failed/dropped/replaced) over the injected adapter.
3. Internally the returned hash is handed to `tx-tracker.watchTransaction`
   (via the same shared `ChainSource`), whose neutral observations advance the
   strip row through its states, including reorg detection.

### Replacement
While a row is pending it offers **Speed up** and **Cancel**:
- *Speed up* — `gas-oracle.recommendBumpTier` / `bumpForReplacement` sizes the
  fee bump; `tx-tracker.replaceTransaction` follows the swap.
- *Cancel* — a 0-value self-send on the **same nonce** through the same
  replacement machinery.
- The strip renders the `replaced` transition distinctly.

## Layout (two-pane; Layout A)

- **Header** — connect/disconnect, connected address, chain name + native
  symbol, live block number.
- **Compose pane (left)** — action selector (Send / Wrap / Unwrap);
  action-specific fields; the four gas tiers as selectable cards with live
  per-tier cost preview; a *Review & send* confirm step showing resolved fee +
  total before signing. Wrap/Unwrap disabled off-registry.
- **Flight pane (right)** — `<TxFlightProvider>` + the in-flight strip. Each
  row: action label, state (awaiting-sig → in-mempool → in-block → confirmed,
  plus replaced / dropped / failed), and Speed up / Cancel while pending.

Two-pane on desktop (both always visible); stacks to single column on mobile.
`tx-flight-react` storage uses the **localStorage** adapter (default) so
in-flight rows survive a reload.

## Error handling (the `viem-errors` showcase)

Every send/replace catch routes through `viem-errors`:

- **User rejection** (`isUserRejectionError`) — the tx does not enter the strip
  as an error (quiet "cancelled", self-dismiss). No scary banner.
- **Contract revert** (Unwrap-overdraw) — `extractContractErrorName` pulls the
  decoded Solidity error name from viem's nested cause chain; the row shows
  `failed · <ErrorName>` with `getUserFriendlyErrorMessage` as the human line.
- **Dropped / replaced-out / reorg** — surfaced from `tx-tracker` observations
  as distinct row states, never collapsed into a generic "error".
- **Typed adapter errors** — `WalletRejectedError` / `ContractRevertedError`
  from `wallet-adapter` caught by `instanceof`, showing typed-catch alongside
  raw-error classification.

## Testing & conventions

- `yarn build` (tsc + vite build) is the CI gate, plus `lint` and `typecheck`.
- **Vitest unit tests** cover pure logic only:
  - WETH registry lookup (chain → address; "no WETH here → disable" decision),
  - amount / fee formatting,
  - cancel-tx request builder (0-value, same nonce),
  - action → transaction-request mapping.
- Wallet-signing and live-chain flows are **not** unit-tested (no wallet in
  CI). The README documents the manual end-to-end run, matching
  `unchained-tx-history`.

## Aesthetic direction

A clean "control panel / flight board" identity, distinct from
`unchained-tx-history`'s graffiti corridor: the in-flight strip reads like a
departures board with state-colored rows and smooth transitions. The detailed
visual pass is tracked as a separate cross-cutting task over all three
examples.

## Out of scope / later

- Theming pass (shared visual identity across the three examples) — separate
  task.
- ERC-20 / approve / 4337 / batching, server relayer, WalletConnect — see
  Non-goals.
