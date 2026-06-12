---
name: tx-tracker-integration
description: Integrate `@valve-tech/tx-tracker` into a wallet UI, indexer, or relay. Use for "track this transaction," "watch tx hash," "know when my tx confirms" (`waitForTransaction`), "detect stuck transactions," "speed up / replace a stuck tx" (`replaceTransaction`), "follow this address's txs," or reorg / replacement / dropped-tx detection. Also fires on imports of `@valve-tech/tx-tracker` and `createTxTracker`, `track` / `subscribe` / `getTxStatus`, `trackFromAddress` / `trackToAddress` / `trackPredicate`, `watchTransaction` / `waitForPending` / `createTxGroup` / `createLocalStorageTrackerStore`, `lostSignalPolicy`, or composing with `@valve-tech/gas-oracle` via a shared `ChainSource`. Skip when the user only wants gas-tier math without per-tx state (delegate to gas-oracle-integration), only wants the raw block/mempool stream with no per-tx logic (delegate to chain-source-integration), or wants a React UI strip for in-flight txs (delegate to tx-flight-react-integration — it wraps tx-tracker for React).
---

# Integrating `@valve-tech/tx-tracker`

Per-tx state machine for EVM chains. Emits **neutral observations**
(`started`, `seen-in-mempool`, `left-mempool`, `seen-in-block`,
`vanished-from-block`, `replaced-by`, `unseen-for-N-blocks`,
`confirmed-terminal`, `signal-degraded`, `signal-recovered`,
`stopped`) so the consumer writes the `'confirmed'` / `'stuck'` /
`'dropped'` policy in their own UX voice. (`confirmed-terminal` is
the one opt-in exception — see anti-pattern 2.)

This skill is for AI agents working in a project that imports the
package — it grounds you in the right consumption shape for the user's
codebase and the right configuration for their use case.

## Decision tree: one-shot helper or owned tracker?

For single-tx questions there are batteries-included helpers that
build (and tear down) a private `ChainSource + TxTracker` internally —
no tracker to own, just a viem `PublicClient`:

```
One transaction, no tracker infrastructure yet?
├── "Know when my tx confirms / drops / is replaced"
│       → await waitForTransaction({ client, hash })
│         Resolves { status: 'mined' | 'dropped' | 'replaced' | 'failed', ... }.
│         ('failed' requires withReceipts: true; outcomes are resolved
│         values, never rejections.)
├── Same, but callback-shaped (no await point available)
│       → watchTransaction({ client, hash, onMined, ... }) — returns stop().
├── "Wait until it shows up in the mempool" (pre-inclusion gate)
│       → await waitForPending({ client, hash })
├── "Bump / cancel a stuck tx" (same-nonce replacement submit)
│       → replaceTransaction({ original, walletClient, newGas })
│         — see "Speed-up workflow" below.
└── "Treat several hashes as one unit" (batch UX)
        → createTxGroup(tracker, hashes) — emits group-progress /
          group-complete / group-failed. (Needs an owned tracker.)
```

For tracking that must survive page reloads, pass a durable store:
`createTxTracker({ source, store: createLocalStorageTrackerStore() })`.

## Decision tree: which consumption shape to use

When you DO own a tracker: three consumption shapes. All three back
onto one push-based core, so they see consistent state — pick by
ergonomics, not by capability.

```
Is the user writing new async code (top-to-bottom flow with await)?
├── Yes — use `for await (const event of tracker.track(hash)) { ... }`.
│         Recommended for new code. Break on terminal conditions inline.
└── No — does the user have existing event-handler / callback code that
         already manages subscription handles?
         ├── Yes — use `tracker.subscribe(hash, cb)`. Returns an
         │         unsubscribe handle. Matches the shape of viem's
         │         watchBlockNumber / watchEvent.
         └── No  — they want the cached snapshot for an imperative read?
                  Use `tracker.getTxStatus(hash)`. Returns null if the
                  hash isn't currently tracked. Sub-millisecond; do NOT
                  call in a render loop, subscribe instead.
```

## Decision tree: which selector for bulk subscription

```
The user wants to watch every tx from / to / matching some criterion:
├── Single sender (treasury, relayer, factory)
│       → tracker.trackFromAddress(addr)
├── Single recipient (contract, EOA)
│       → tracker.trackToAddress(addr)
└── Arbitrary predicate (gas-price band, calldata pattern, value range)
        → tracker.trackPredicate((tx) => /* boolean */)
          NOTE: predicate runs O(N) per tx per tick. Keep it fast.
          NOTE: predicate selectors are non-durable (closures don't
          serialize). `from` / `to` selectors ARE durable.
```

`autoTrackMatched: true` (default) creates an implicit per-hash
subscription on every matched hash, so the consumer can use
`sub.subscribe(cb)` to get the per-hash event stream too. Set
`false` if the consumer only wants the raw `matched` stream.

## Composing with gas-oracle (one upstream RPC stream)

When the user has BOTH gas-oracle and tx-tracker, they should share
ONE `ChainSource`. One upstream poll cycle, two derived views:

```ts
import { createChainSource } from '@valve-tech/chain-source'
import { createGasOracle } from '@valve-tech/gas-oracle'
import { createTxTracker } from '@valve-tech/tx-tracker'

const source  = createChainSource({ client })
const oracle  = createGasOracle({ source, chainId: 1 })
const tracker = createTxTracker({ source, chainId: 1 })

source.start(); oracle.start(); tracker.start()
```

Each surface owns its own lifecycle. `oracle.stop()` does NOT stop the
source or the tracker. `source.stop()` halts the upstream loop;
attached consumers stop receiving events but their subscriptions stay
registered (a later `source.start()` resumes them).

## Per-chain config (always required)

| Setting | Default | Tune up for | Tune down for |
|---|---|---|---|
| `reorgDepthBlocks` | 12 | Chains with weaker finality (PoW, small validator sets) | High-finality chains where you only care about shallow reorgs |
| `unseenThresholdBlocks` (per-sub or tracker default) | 30 | Fast chains, to keep wall-clock patience constant (30 blocks on a 2s L2 elapses in ~1 min) | Slow chains where the default wall-clock wait is too long (30 × 12s mainnet blocks ≈ 6 min before "likely dropped") |
| `lostSignalPolicy` | `'emit-uncertain'` | (default — loud is correct) | `'silent'` for wallet UIs that don't want capability-churn UI flicker; `{ strategy: 'receipt-poll-fallback', pollEveryBlocks }` to keep inclusion signal alive via `eth_getTransactionReceipt` — the right answer for gated-txpool chains like PulseChain |
| `statusPollEveryBlocks` | 1 | (default — polls `eth_getTransactionByHash` per tracked record every block; universally exposed, sees txs even where `txpool_content` is gated) | `2`+ to halve the per-record RPC cost; `0` to disable the status-poll path entirely |
| `confirmationsForTerminal` | `null` (off) | Long-lived / durable stores — REQUIRED there, or mined records never expire (see anti-pattern 2). Use ≥ `reorgDepthBlocks` | Leave `null` for short-lived in-memory trackers where leak pressure doesn't exist |
| Store retention (`createInMemoryStore({ retentionBlocks })`) | 64 | Indexers replaying long windows | Wallet UIs where in-flight is what matters |

`reorgDepthBlocks`, retention, and `unseenThresholdBlocks` are in
**block-units, not seconds** — think in wall-clock by multiplying by
the chain's block time. Reorg safety is a depth invariant. Spec §10.1
has the rationale.

## Anti-patterns to flag

1. **Constructing a fresh `ChainSource` per tracker per hash.** One
   source per chain, shared across every consumer. Constructing a
   second source for the same chain doubles the upstream RPC traffic.

2. **Treating `seen-in-block` as "confirmed."** It's the inclusion
   observation, not the policy. Consumer should check
   `event.confirmations >= N` with N from their own UX rules. By
   default the tracker emits no confirmed event — but
   `confirmationsForTerminal` (default `null`) opts into a one-shot
   `confirmed-terminal` event that also marks the record terminal so
   retention can reclaim it. For long-lived stores (durable stores,
   indexers) setting it is REQUIRED: without a terminal on the happy
   path, normally-mined records never expire and leak. Recommended
   value: ≥ `reorgDepthBlocks` (default 12), so a same-height reorg
   can't un-mine a record already retired.

3. **Calling `getTxStatus(hash)` in a render loop.** Sub-ms but still
   wasteful. Subscribe via `tracker.subscribe(hash, cb)` and store
   the latest event in a state hook / module variable.

4. **Ignoring `signal-degraded` events** when the consumer's UX
   depends on hard inclusion guarantees (relays, settlement). The
   default policy emits these for a reason — when WS drops mid-track,
   the receipt-poll fallback is informational only and cannot detect
   reorgs.

5. **`durable: true` on a `predicate` selector.** Closures don't
   serialize; the tracker silently demotes to non-durable and logs
   via `onError`. Use `from` / `to` selectors when durability matters.

6. **Polling `getTxStatus` to detect changes.** If you find yourself
   in a `setInterval` reading the snapshot, you wanted `subscribe`
   from the start.

7. **Stopping the tracker without unsubscribing per-hash callbacks
   first.** `tracker.stop()` emits a final `stopped` event to every
   per-hash subscriber, then drops the records. That's the intended
   shape — but consumers expecting their `subscribe` callback to
   never fire after their own `unsub()` should call `unsub()` first
   (it's idempotent and emits its own `stopped` with reason
   `'unsubscribed'`).

8. **Reading `event.at.timestamp === 0n` and treating it as "now."**
   `0n` means "no canonical block has been observed yet" (the
   subscription's synthetic `started` event fires before any block
   tick). Wait for a real event before reading `timestamp`.

## Capability disclosure — the no-silent-downgrade rule

Every event carries a `source` field. When upstream RPC capability
changes (WS drops, `txpool_content` newly gated), the tracker emits
`signal-degraded` with `capabilityLost` and `fallbackSource`. Consumers
that need hard guarantees filter to `event.source === 'subscription'`.

`tracker.capabilities()` returns the source's current snapshot. Use
this on subscribe to decide your fallback posture upfront rather than
reacting to the first `signal-degraded`.

## How to recognize this package in the user's code

```ts
import { createTxTracker } from '@valve-tech/tx-tracker'
import { createInMemoryStore } from '@valve-tech/tx-tracker'
import type { TxEvent, TxStatus } from '@valve-tech/tx-tracker'

// Composing with gas-oracle:
import { createChainSource } from '@valve-tech/chain-source'
import { createGasOracle } from '@valve-tech/gas-oracle'
```

`package.json` will show `@valve-tech/tx-tracker` at any `0.x` of the
toolkit's synced release line, and almost always
`"@valve-tech/chain-source"` alongside it (the tracker requires a
source).

## Speed-up workflow (cross-package)

The tracker never emits a "stuck" event — `unseen-for-N-blocks` is the
neutral observation you key your stuck policy on. To bump a stalled tx,
pair the tracker's own `replaceTransaction` helper with
`@valve-tech/gas-oracle`'s `recommendBumpTier` + `bumpForReplacement`:

```ts
import { replaceTransaction, type TxEvent } from '@valve-tech/tx-tracker'
import { recommendBumpTier, bumpForReplacement } from '@valve-tech/gas-oracle'

// Keep the original request + gas at submit time — tracker events
// don't carry them:
const original = { to, nonce, data, value }  // ReplaceTransactionOriginal
const originalGas = { maxFeePerGas, maxPriorityFeePerGas }

const onStuck = async (event: TxEvent) => {
  if (event.kind !== 'unseen-for-N-blocks') return  // your "stuck" policy

  const snapshot = oracle.getState()
  if (snapshot === null) return  // oracle hasn't polled yet

  const tier = recommendBumpTier(snapshot, {
    priorityTip: originalGas.maxPriorityFeePerGas,
    identifier: { hash },
  })
  if (tier === null) return  // Already paying above top tier — caller's call

  const newGas = bumpForReplacement(originalGas, snapshot.tiers[tier])
  const newHash = await replaceTransaction({ original, walletClient, newGas })

  unsub()                              // old hash is superseded
  tracker.subscribe(newHash, onStuck)  // follow the replacement
}
const unsub = tracker.subscribe(hash, onStuck)
```

`replaceTransaction({ original, walletClient, newGas })` submits the
same-nonce replacement and returns the new hash; it throws whatever the
wallet client throws (no swallowing — caller decides retry/surface).
Outpace correction (passing `identifier`) reads `snapshot.mempoolSamples`
to compute the tip needed to outpace the stuck tx in the live
distribution, on top of the EIP-1559 +10% protocol floor.

## Where to find more

- Full API + types: `node_modules/@valve-tech/tx-tracker/AGENTS.md`
- Runnable examples (not shipped in the tarball):
  https://github.com/valve-tech/evm-toolkit/tree/main/packages/gas-oracle/examples
  (`07-tx-tracker.ts` etc.)
- Design contract (the source of truth):
  https://github.com/valve-tech/evm-toolkit/tree/main/docs/tx-tracker-spec.md
- Source (when types alone aren't enough):
  `node_modules/@valve-tech/tx-tracker/dist/` (compiled JS + .d.ts)
