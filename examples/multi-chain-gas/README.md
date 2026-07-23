# multi-chain-gas

Watch several EVM chains' fee markets **side by side**, and get alerted
when a tier crosses a threshold you set.

The single-chain sibling (`examples/gas-dashboard`) goes deep on one
chain — mempool histogram, block-position estimator. This example goes
wide instead: one `@valve-tech/chain-source` + `@valve-tech/gas-oracle`
pipeline **per configured chain, all running concurrently**, feeding

- a live card per chain (tiers, base-fee sparkline, trend, block),
- a compare table lining the chains' tips up per block, and
- **edge-triggered threshold alerts** — "Ethereum fast tip below
  2 gwei" fires once when it crosses, not once per block while it
  stays cheap — as in-app log entries and (opt-in) browser
  notifications. Rules persist in localStorage.

No wallet, no server — public RPCs only; deploy = copy `dist/`.

## Run it

```bash
# from the repo root
yarn install
yarn workspace @valve-tech/example-multi-chain-gas dev
```

## What it demonstrates

- **One ChainSource per chain** is the toolkit invariant, at fleet
  scale — `src/lib/fleet.ts` is gas-dashboard's `createDashboard`
  fanned out, with every callback tagged by `chainId`. No cross-chain
  state exists below the UI.
- **Pure alert engine** (`src/lib/alerts.ts`, tested in
  `alerts.test.ts`): rules are data, matching is a pure function over
  `GasOracleState`, and edge-triggering is explicit state the caller
  carries between evaluations — the same
  pure-functions-under-a-stateful-shell shape as the toolkit packages.
- **Capability awareness**: chains whose RPC lacks WS push show an
  "http polling" note; an unresponsive RPC renders as dashes in the
  compare table rather than disappearing.

## Configuration

Edit `src/config.ts` — each entry is `{ chainId, label, rpcUrl,
symbol, explorerUrl }`. Every configured chain runs concurrently, so
keep the list within the public RPCs' rate limits (three ships by
default: PulseChain, PulseChain Testnet v4, Ethereum).
