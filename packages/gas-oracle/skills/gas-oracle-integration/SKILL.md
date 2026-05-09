---
name: gas-oracle-integration
description: Integrate `@valve-tech/gas-oracle` into an EVM dapp or backend. Use when the user wants gas-tier recommendations (`slow` / `standard` / `fast` / `instant`), needs to set `maxPriorityFeePerGas` and `maxFeePerGas` for a transaction, asks "how do I price a transaction" against a viem `PublicClient`, or wants to bump a stuck tx (`recommendBumpTier` / `bumpForReplacement`). Also use when seeing imports from `@valve-tech/gas-oracle` and the user asks for help configuring it per chain (Ethereum, Base, Arbitrum, OP, PulseChain), or asks about `priorityFeeDecayCap`, `priorityModel`, `tipForBlockPosition`, `classifyTip`, `chainPresets`, viem-actions, or viem-transport. Also fires when the user asks about composing the oracle with `@valve-tech/tx-tracker` over a shared `ChainSource` — but actual per-tx tracking work belongs in the tx-tracker skill, not here. Skip when the user only wants per-tx state (delegate to tx-tracker-integration), only wants the raw block/mempool stream with no gas math (delegate to chain-source-integration), or is doing simple `eth_gasPrice` queries that don't need multi-tier reasoning (vanilla viem suffices).
---

# Integrating `@valve-tech/gas-oracle`

Multi-tier gas-fee oracle for EVM chains. This skill is for AI agents
working in a project that imports the package — it grounds you in the
right configuration choices for the user's chain and the right
integration shape for their codebase.

> **v0.8.0 default change**: `priorityModel` now defaults to `PriorityModel.eip1559` (was `flat`). Examples that previously omitted the field silently get the new default. Set `PriorityModel.flat` explicitly for PulseChain (chain 369) — or use `...chainPresets.pulsechain`.

## Decision tree: which integration to use

```
Is the user already passing a viem PublicClient around?
├── Yes — use viem-actions (`client.extend(gasOracleActions(...))` or
│         the direct invocation `gasOracleActions(opts)(client)`).
│         Most ergonomic for app code.
└── No — does the user have wagmi/viem code that already calls
         `client.getGasPrice()` / `eth_maxPriorityFeePerGas`?
         ├── Yes — use viem-transport (`withGasOracle(transport, ...)`)
         │         to intercept those methods at the RPC layer. Drop-in.
         │         No call-site changes.
         └── No — use the direct constructor `createGasOracle(opts)`.
                  Simplest. Read tiers via `oracle.getState()?.tiers`.
```

## Per-chain config (always required)

| Chain | `chainId` | `priorityModel` | `baseFeeLivenessBlocks` | Notes |
|---|---|---|---|---|
| Ethereum mainnet | 1 | `PriorityModel.eip1559` (default) | 6 | Validators burn base fee. |
| Base | 8453 | `PriorityModel.eip1559` (default) | 6 | Same as ETH. |
| Arbitrum One | 42161 | `PriorityModel.eip1559` (default) | 6 | |
| Optimism | 10 | `PriorityModel.eip1559` (default) | 6 | |
| PulseChain mainnet | 369 | `PriorityModel.flat` | 6 | Validators charge tips. Use `...chainPresets.pulsechain`. |
| PulseChain testnet v4 | 943 | `PriorityModel.flat` | 6 | |
| Unknown / unsure | — | `PriorityModel.eip1559` (default) | 6 | Default is correct unless you've verified the chain is extractive. |

`priorityFeeDecayCap`: leave at default (`WAD/8` = 12.5%/block, EIP-1559
parity) unless you have a specific reason to tighten/loosen.

## Anti-patterns to flag

When reviewing user code, watch for these and suggest fixes:

1. **Multiple oracles per chain in the same process.** Construct once,
   module-scope it. Each oracle runs a poll interval and holds state.
   Two oracles for chain 1 = double the RPC traffic, no benefit.

2. **`oracle.getState()` in a hot path that runs every render / every
   request.** It's O(1) but you're wasting cache lines. Either subscribe
   via `oracle.subscribe(cb)` and store the latest state in a module
   variable, or cache the result yourself with a short TTL.

3. **Reading `oracle.getState()` immediately after `oracle.start()`
   without handling null.** First poll hasn't completed yet; tiers will
   be missing. Fix: `await oracle.pollOnce()` after `start()` to seed
   state synchronously, then it's safe to call `getState()`.

4. **Using `PriorityModel.eip1559` on PulseChain or other tip-charging
   chains.** This is now the default — silent footgun on chain 369
   unless you set `PriorityModel.flat` (or use `...chainPresets.pulsechain`).
   It cuts the distribution to type-2+ samples only, but PulseChain
   validators don't honor the type byte — they sort by tip regardless.
   Result: under-published tier values, your tx loses to legacy spam.

5. **`keepMempoolSnapshot: true` on a chain whose RPC gates
   `txpool_content`** (most public RPCs). Wastes a poll cycle's RPC
   budget on a request that always errors. Set `false` until you have
   a node you operate.

6. **Calling `findTxInMempool` with a hash that's been confirmed.**
   Confirmed txs are NOT in the mempool snapshot (it's pending+queued
   only). Check `eth_getTransactionByHash` instead.

## How to recognize this package in the user's code

```ts
// Direct constructor
import { createGasOracle } from '@valve-tech/gas-oracle'

// viem-actions extension
import { gasOracleActions } from '@valve-tech/gas-oracle/viem-actions'

// viem-transport interception
import { withGasOracle } from '@valve-tech/gas-oracle/viem-transport'
```

`package.json` will show `"@valve-tech/gas-oracle": "^0.2.x"` in dependencies.

## Replacement workflow — bumping a stuck tx

When the user has a stuck tx and asks how to bump / speed it up,
recommend the `recommendBumpTier` + `bumpForReplacement` pair. This is
the canonical caller pattern; don't roll your own +10% math:

```ts
import {
  recommendBumpTier,
  bumpForReplacement,
  BumpStrategy,
} from '@valve-tech/gas-oracle'

const tier = recommendBumpTier(
  state,
  { priorityTip: stuck.maxPriorityFeePerGas, identifier: { hash: stuck.hash } },
  { strategy: BumpStrategy.cheapestThatLands },  // default
)
if (tier === null) return  // already paying above top tier — caller's call

const target = state.tiers[tier]
const gas = bumpForReplacement(
  { maxFeePerGas: stuck.maxFeePerGas, maxPriorityFeePerGas: stuck.maxPriorityFeePerGas },
  { maxFeePerGas: target.maxFeePerGas, maxPriorityFeePerGas: target.maxPriorityFeePerGas },
)
walletClient.sendTransaction({ ...stuck, ...gas })
```

`recommendBumpTier` reads `state.mempoolSamples` to compute outpace
correction (when an `identifier` is supplied) on top of the EIP-1559
+10% protocol floor. `bumpForReplacement` returns a gas object that
satisfies BOTH the protocol floor and the target tier — never one or
the other.

## Tip classification

Inverse of `tipForBlockPosition`. Given a tip, ask "where would this
land?" instead of "what tip do I need to land here?":

```ts
import { classifyTip } from '@valve-tech/gas-oracle'

const result = classifyTip(state, myTip)
// result.tier                 — TierName | null (null if below slow)
// result.requiredForNextTier  — bigint floor of next tier above (null at instant)
// result.percentile           — bigint 0-100 (0 = top, 100 = bottom)
// result.rank                 — bigint 0-indexed from top
// result.gasFromTop           — bigint accumulated gas above this tip
```

Useful for "your fee is low — bump?" UX nudges and for showing a
user where their existing in-flight tx sits vs. live competition.

## UI labels

Branded / localized inclusion-time copy without forking the package:

```ts
import { defaultInclusionLabels, inclusionLabel, TierName } from '@valve-tech/gas-oracle'

defaultInclusionLabels[TierName.standard]   // 'Next block'

const es = { [TierName.standard]: 'Próximo bloque' }
inclusionLabel(TierName.standard, es)        // 'Próximo bloque'
inclusionLabel(TierName.slow, es)            // falls back to default English
```

Pass partial overrides — anything not in the override map falls back
to the package default.

## Chain presets

For PulseChain (and any future entries we ship), use the preset entry
points instead of typing `chainId` + `priorityModel` by hand:

```ts
import { createGasOracle, chainPresets, presetForChainId } from '@valve-tech/gas-oracle'

// Static — caller knows which chain at code-time:
createGasOracle({ client, ...chainPresets.pulsechain })

// Dynamic — caller has chainId at runtime (e.g. from wallet):
const preset = presetForChainId(chainId)
createGasOracle({ client, chainId, ...preset })
```

`presetForChainId` returns `undefined` for unknown chains; spreading
`undefined` into the options object is a no-op, so the call still works
on a chain we haven't preset (it just gets the package defaults).

## Where to find more

- Full API + types: `node_modules/@valve-tech/gas-oracle/AGENTS.md`
- Runnable examples: `node_modules/@valve-tech/gas-oracle/examples/`
- Human-facing docs: `node_modules/@valve-tech/gas-oracle/README.md`
- Source (when types alone aren't enough): `node_modules/@valve-tech/gas-oracle/dist/`
  (compiled JS + .d.ts) — sources aren't shipped, only built output.

## Tx tracking — composing with `@valve-tech/tx-tracker`

When the user asks to "track this transaction," "watch tx hash,"
"know when my tx confirms," or "detect stuck transactions," redirect
them to `@valve-tech/tx-tracker` (sibling package). The gas oracle
does NOT track per-tx state — that's a separate concern with its own
state machine, retention policy, and consumption shapes. See
`node_modules/@valve-tech/tx-tracker/skills/tx-tracker-integration/SKILL.md`
for the full integration recipe.

The two packages are designed to share one upstream RPC stream:

```ts
import { createChainSource } from '@valve-tech/chain-source'
import { createGasOracle }   from '@valve-tech/gas-oracle'
import { createTxTracker }   from '@valve-tech/tx-tracker'

const source  = createChainSource({ client })
const oracle  = createGasOracle({ source, chainId: 1 })
const tracker = createTxTracker({ source, chainId: 1 })

source.start(); oracle.start(); tracker.start()
```

`ChainSource` owns the upstream poll cycle. The oracle reads it for
tier reduction; the tracker reads it for per-tx observations. **One
upstream RPC poll cycle, two derived views** (per spec §3.1). Each
surface owns its own lifecycle — `oracle.stop()` does not stop the
source or the tracker.

### Anti-patterns when both are present

7. **Constructing a private `ChainSource` for the tracker AND passing
   `client` (not `source`) to `createGasOracle`.** That gives you two
   independent sources for the same chain — double the RPC traffic
   for no functional benefit. Either pass `source` to BOTH, or use
   the `client` shorthand on BOTH (one private source on the oracle's
   side, no tracker — meaningless if you want both).

8. **Asking the gas oracle "is my tx confirmed?"** Wrong layer. The
   oracle publishes tier recommendations; it does not observe per-tx
   state. Use `tracker.getTxStatus(hash)` or
   `tracker.subscribe(hash, cb)` from `@valve-tech/tx-tracker`.

### Recognizing both packages in the user's code

```ts
import { createGasOracle } from '@valve-tech/gas-oracle'
import { createTxTracker } from '@valve-tech/tx-tracker'
// `package.json` will have both under dependencies, plus
// `@valve-tech/chain-source` (the shared foundation both consume).
```
