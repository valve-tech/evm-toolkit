# @valve-tech/tx-tracker

Per-tx state machine for EVM chains. Emits **neutral observations** —
`seen-in-mempool`, `seen-in-block`, `replaced-by`, `vanished-from-block`,
`unseen-for-N-blocks`, `signal-degraded`, `signal-recovered`, `stopped` —
so wallet UIs, indexers, and relays can write their own interpretations
on top. The package itself never says "confirmed" or "stuck"; it gives
you the data to decide.

See
[`docs/tx-tracker-spec.md`](https://github.com/valve-tech/evm-toolkit/blob/main/docs/tx-tracker-spec.md)
for the full design contract.

## Why this exists

Tx-tracking on EVM is unforgiving:

- **Three different consumer shapes** (wallet UI, indexer, relay) want
  the same underlying observations but very different consumption
  ergonomics.
- **Five state transitions** (pending, mined, replaced, dropped,
  reorged) plus their authoritative-vs-degraded sources.
- **Per-method capability variance** — some upstreams gate
  `txpool_content`, some allow `eth_subscribe('newHeads')` but not
  `newPendingTransactions`, some only offer HTTP.
- **No silent downgrade** — a tracker that says "your tx is mined"
  when the WS dropped and the receipt poll happens to still see the
  old block is lying. Every event in this package carries a `source`
  discriminator (`'subscription'` / `'block-poll'` /
  `'mempool-snapshot'` / `'receipt-poll'`) so consumers know how
  authoritative it is.

This package handles all of it as one push-based core with three thin
adapters (callback / async iterator / snapshot).

## Install

```bash
yarn add @valve-tech/tx-tracker @valve-tech/chain-source viem
```

`@valve-tech/chain-source` is a runtime dependency — the tracker
consumes its block + mempool stream rather than re-implementing the
poll loop. `viem ^2.0.0` is the only external peer.

## Quick start

```ts
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { createChainSource } from '@valve-tech/chain-source'
import { createTxTracker } from '@valve-tech/tx-tracker'

const client  = createPublicClient({ chain: mainnet, transport: http() })
const source  = createChainSource({ client })
const tracker = createTxTracker({ source, chainId: 1 })

source.start(); tracker.start()

// Async iterator — recommended for new code:
for await (const event of tracker.track('0xabc...')) {
  if (event.kind === 'seen-in-block' && event.confirmations >= 6) break
}
```

## Three consumption shapes

All three back the same internal `Subscriptions<TxEvent>` per hash, so
they see consistent state. Pick whichever fits the call site.

### 1. Snapshot — sub-millisecond, returns `null` if not tracked

```ts
const status = tracker.getTxStatus(hash)
if (status?.lastSeenInBlock?.confirmations >= 6) {
  // do confirmed-thing
}
```

### 2. Callback — returns an unsubscribe handle

```ts
const unsub = tracker.subscribe(hash, (event) => {
  if (event.kind === 'seen-in-block') showConfirmation(event)
  if (event.kind === 'replaced-by')   showReplacement(event)
  if (event.kind === 'unseen-for-N-blocks' && event.blocks >= 30) showStuckHint()
})
// later
unsub()
```

### 3. Async iterator — recommended for new code

```ts
for await (const event of tracker.track(hash)) {
  switch (event.kind) {
    case 'seen-in-block':
      if (event.confirmations >= 6) return  // exits the loop
      break
    case 'replaced-by':
      reportReplacement(event.replacementHash)
      return
    case 'stopped':
      return  // tracker shut down or retention expired
  }
}
```

The iterator stops cleanly on tracker shutdown, retention expiry, or
explicit `unsubscribe`. No event-listener leaks — `for await` cleanup
runs the iterator's `return()` automatically when the loop exits.

## What you'll likely want to do

### "Confirm a tx"

```ts
for await (const event of tracker.track(hash)) {
  if (event.kind === 'seen-in-block' && event.confirmations >= confirmsRequired) {
    return event   // confirmed
  }
  if (event.kind === 'replaced-by' || event.kind === 'unseen-for-N-blocks') {
    throw new Error(`tx didn't confirm: ${event.kind}`)
  }
}
```

`waitForTransaction(hash, { confirmations, source })` ships as a
one-shot helper if you don't need the per-event control:

```ts
import { waitForTransaction } from '@valve-tech/tx-tracker'

const event = await waitForTransaction(hash, { source, chainId: 1, confirmations: 6 })
```

### "Detect a stuck tx and prompt the user to bump"

```ts
const unsub = tracker.subscribe(hash, (event) => {
  if (event.kind === 'unseen-for-N-blocks' && event.blocks >= 30) {
    promptUserToBump()           // 30 blocks ≈ 6 min on Ethereum
  }
})
```

`unseenThresholdBlocks` (default 30) controls when the
`unseen-for-N-blocks` event fires. Tune lower for fast L2s, higher
for slow chains.

### "Watch all txs from an address (indexer-style bulk)"

```ts
const sub = tracker.trackFromAddress(treasuryAddress, { durable: true })

// Raw match stream:
for await (const m of sub.events()) {
  console.log('match', m.hash, m.bucket)
}

// Per-hash event stream (auto-tracked by default):
sub.subscribe((event) => {
  if (event.kind === 'seen-in-block') ingestConfirmed(event)
})

sub.stop()  // stops match stream; does NOT stop already-auto-tracked per-hash subs
```

`trackFromAddress` / `trackToAddress` / `trackPredicate` — capped at
`maxBulkSubscriptions: 16` by default. Per-hash auto-tracking can be
disabled via `{ autoTrack: false }` for replay-only consumers.

### "Detect a replacement (speed-up / cancel)"

```ts
for await (const event of tracker.track(hash)) {
  if (event.kind === 'replaced-by') {
    // event.replacementHash is the new tx; event.replacementBlockNumber
    // is null until the replacement itself mines.
    console.log(`replaced by ${event.replacementHash}`)
    break
  }
}
```

Replacement detection runs nonce-watching on the same sender + nonce.
Works for both speed-up (same nonce, higher tip) and cancel
(self-send to clear the slot).

## Configuration patterns

| Setting | Default | Tune up for | Tune down for |
|---|---|---|---|
| `reorgDepthBlocks` | 12 | Weak-finality chains (PoW, small validator sets) | High-finality chains; only care about shallow reorgs |
| `unseenThresholdBlocks` | 30 | Slow chains (Ethereum: ~6 min) | Fast L2s |
| `lostSignalPolicy` | `'emit-uncertain'` | (default — loud is correct) | `'silent'` for wallets that don't want capability-churn UI flicker |
| `createInMemoryStore({ retentionBlocks })` | 64 | Indexers replaying long windows | Wallet UIs |
| `createInMemoryStore({ eventLogCapacity })` | 256 | Heavy catch-up on restart | Memory-constrained mobile / edge |

`reorgDepthBlocks` and retention are in **block-units, not seconds** —
reorg safety is a depth invariant. See spec §10.1.

## Composing with `@valve-tech/gas-oracle`

One `ChainSource` shared across both — one upstream RPC poll cycle:

```ts
import { createChainSource } from '@valve-tech/chain-source'
import { createGasOracle }   from '@valve-tech/gas-oracle'
import { createTxTracker }   from '@valve-tech/tx-tracker'

const source  = createChainSource({ client })
const oracle  = createGasOracle({ source, chainId: 1 })
const tracker = createTxTracker({ source, chainId: 1 })

source.start(); oracle.start(); tracker.start()
// ↑ ONE upstream poll cycle. Two derived views.
```

Each surface owns its own lifecycle — `oracle.stop()` does not stop
the source or the tracker. The owner of the source (whoever called
`createChainSource`) calls `source.stop()` when the process shuts
down.

For React in-flight tx UIs, `@valve-tech/tx-flight-react` wraps
tracker + wallet-adapter into a Provider + headless components, so
you don't have to wire any of this by hand for the UI side.

## Capability disclosure (the no-silent-downgrade rule)

`tracker.capabilities()` forwards the source's snapshot:

```ts
{
  newHeads:                'subscription' | 'poll-only' | 'unavailable'
  newPendingTransactions:  'subscription' | 'poll-only' | 'unavailable'
  txpoolContent:           'available' | 'gated'
  receiptByHash:           'available' | 'unavailable'
  reprobeOnReconnect:      boolean
}
```

When capabilities change mid-tracking (WS dropped, txpool gated, etc.),
the tracker emits `signal-degraded` / `signal-recovered` per affected
key. Consumers that need hard inclusion guarantees filter to
`event.source === 'subscription'`. Consumers that just want "best
available" data ignore the discriminator.

`lostSignalPolicy: 'emit-uncertain'` (the default) is the loud-is-right
choice — UI consumers want to surface "we lost push to the chain;
falling back to poll" so the user knows the bar might be lagging.
Switch to `'silent'` when you genuinely don't care about capability
churn (some indexers, server-side relays).

## Wire format

All numeric fields are `bigint` (block numbers, fees, timestamps).
`JSON.stringify(event)` will throw without hex-encoding at the wire
boundary. Durable store implementers MUST hex-encode (`'0x' +
n.toString(16)`) on write and decode on read. The default in-memory
store keeps `bigint` end-to-end.

## Examples

Runnable scripts (live under the gas-oracle examples directory — the
toolkit hosts shared examples there):

- `examples/07-tx-tracker.ts` — minimal tracker, no oracle (async iterator)
- `examples/08-tx-tracker-with-oracle.ts` — shared `ChainSource` between gas-oracle + tracker
- `examples/09-bulk-from-address.ts` — indexer-style bulk subscription

Run with `yarn tsx examples/07-tx-tracker.ts`.

## For AI agents

This package ships an [`AGENTS.md`](AGENTS.md) reference (full surface
in tabular form, capability matrix, every event variant) and a
[`skills/`](skills/) directory for Claude Code / Cursor skill files
shipped in the npm tarball. After install, both are reachable at:

- `node_modules/@valve-tech/tx-tracker/AGENTS.md`
- `node_modules/@valve-tech/tx-tracker/skills/tx-tracker-integration/SKILL.md`

The skill triggers on imports of `@valve-tech/tx-tracker` and on
phrases like "track this transaction", "watch tx hash", "detect stuck
transactions", "watch for replaced txs". It includes a decision tree
for picking among the three consumption shapes, anti-patterns to flag
in user code, and the canonical composition pattern with gas-oracle.

## Verifying provenance

v0.6.0+ ships with SLSA provenance attestation:

```bash
npm view @valve-tech/tx-tracker@latest --json | jq .dist.attestations
npm audit signatures
```

The attestation links the published tarball to the GitHub Actions
workflow run that built it.

## License

MIT
