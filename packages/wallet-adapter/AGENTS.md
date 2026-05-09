# AGENTS.md

Terse reference for AI agents (Claude Code, Cursor, Aider, etc.) integrating
`@valve-tech/wallet-adapter`. The full README is for humans; this file is for
agents that need to ground their work in the package's actual surface
quickly.

## What this package does

Framework-agnostic **vocabulary** for EVM dapp wallet integration —
not a wallet implementation. Pure types + a few `as const` lifecycle
constants + two thin helpers that do the wallet-side and chain-side
phase wiring around `wallet.sendTransaction` and
`waitForTransactionReceipt`.

The point: every SDK / dapp / UI in your stack speaks the same wallet
shape, the same lifecycle phases, the same in-flight tx vocabulary.
No bespoke "awaiting signature" state machine per integration; no
`hash → request` side-channel maps in your callbacks.

`@valve-tech/viem-errors` is the only runtime dep (used for the
wallet-rejection discriminator). `viem ^2.0.0` is the peer.

## Public API

All exports live under `src/index.ts`. Single subpath; no sub-exports.

```ts
import {
  // helpers
  sendTransactionWithHooks,           // wallet-side
  awaitReceiptWithHooks,              // chain-side; fetches containing block by default
  // typed errors (use instanceof to discriminate)
  WalletRejectedError,
  ContractRevertedError,
  // lifecycle constants
  TX_STATUS,                          // 'preparing' | 'awaiting-signature' | 'pending' | 'confirmed' | 'failed' | 'replaced' | 'dropped'
  TX_FLOW,                            // intentionally empty — protocols extend
  STALE_TX_AGE_MS,
  CONFIRMED_DISPLAY_MS,
  FAILED_DISPLAY_MS,
  // types
  type WalletAdapter,
  type WalletSendTransactionRequest,
  type WalletReadContractRequest,
  type WriteHookParams,
  type WritePhase,
  type WritePhaseSteps,
  type WritePhaseEvent,
  type TxContext,
  type TrackedTx,
  type TrackedTxGas,
  type TrackedTxStatus,
  type TxFlow,
  type TxConfirmedCallback,
  type SendTransactionWithHooksOptions,
  type AwaitReceiptWithHooksOptions,
  type ReceiptAwaiter,
} from '@valve-tech/wallet-adapter'
```

## Six types you must know

| Type | What it is |
|---|---|
| `WalletAdapter` | The contract an SDK accepts in lieu of coupling to wagmi / ethers / viem direct / a smart account. `{ address?, sendTransaction(req), readContract?(req) }`. |
| `WriteHookParams` | Per-phase callback bag. Six named hooks (`onAwaitingSignature`, `onTransactionHash`, `onConfirmed`, `onFailed`, `onDropped`, `onReplaced`) + complementary `onPhase(event)` discriminated-union shape. Both shapes fire for every transition — exactly once each. |
| `TxContext<Extra>` | The always-present info bag carried on every event: `{ chainId, request } & Extra`. Consumers never have to side-channel chain ID or the original send request. |
| `WritePhaseSteps` | Per-phase data delta map (`pending: { hash }`, `confirmed: { hash, receipt, block? }`, `failed: { error, hash?, receipt?, block? }`, etc.). Open to declaration merging — extend it from your code if you have additional phases. |
| `WalletRejectedError` | Thrown by `sendTransactionWithHooks` on user rejection. `Error` subclass with `cause: Error`. Discriminate via `instanceof`. |
| `ContractRevertedError` | Thrown by `awaitReceiptWithHooks` on `status: reverted`. Carries `hash` + the full `receipt` for log inspection. |

## The two helpers — what they fire and when

### `sendTransactionWithHooks({ wallet, request, hooks?, onTransactionHash? })`

Wallet-side. Returns `Promise<Hex>` resolving to the tx hash.

| Phase | Fires |
|---|---|
| Pre-wallet (always once) | `onAwaitingSignature(ctx)` + `onPhase('awaiting-signature', ctx)` |
| Hash returned (always once on success) | `onTransactionHash(ctx + { hash })` (per-call) AND the global `onTransactionHash` if passed AND `onPhase('pending', ctx + { hash })` |
| Wallet rejection | `onFailed(ctx + { error: WalletRejectedError })` + `onPhase('failed', ...)`, then **throws `WalletRejectedError`** |
| Other thrown error | `onFailed(ctx + { error: <thrown> })` + `onPhase('failed', ...)`, then **re-throws unchanged** |

`onTransactionHash` accepts both a per-call hook (in `hooks.onTransactionHash`) AND a top-level argument for analytics/global-channel observers. Both fire exactly once.

### `awaitReceiptWithHooks({ publicClient, hash, request, includeBlock?, hooks? })`

Chain-side. Returns `Promise<TransactionReceipt>` on success.

| Outcome | Fires |
|---|---|
| `receipt.status === 'success'` | Fetches containing block (unless `includeBlock: false`), then `onConfirmed(ctx + { hash, receipt, block? })` + `onPhase('confirmed', ...)` |
| `receipt.status === 'reverted'` | Fetches containing block, then `onFailed(ctx + { hash, receipt, block?, error: ContractRevertedError })` + `onPhase('failed', ...)`, then **throws `ContractRevertedError`** |
| Network/RPC/abort during await | `onFailed(ctx + { error: <thrown> })` (no `hash`/`receipt`/`block`) + `onPhase('failed', ...)`, then **re-throws unchanged** |

`request` is **load-bearing** — populates `TxContext` on every emitted event. Don't omit it.

`includeBlock: true` (the default) fetches the containing block once after a successful receipt-await so downstream consumers (notably `@valve-tech/tx-tracker`) skip the round trip for `timestamp` / `baseFeePerGas`. Pass `false` if you don't need block-level data.

## What the helpers DON'T fire

`onDropped` and `onReplaced` are part of the `WriteHookParams` contract but **not** fired by this package's helpers. Honestly distinguishing "still propagating" from "permanently dropped" requires multi-block observation; replacement detection requires nonce-watching across the same nonce — that's `@valve-tech/tx-tracker`'s job.

The hooks live here so consumers wire **one** set of callbacks; the tracker fires them when it ships. Wiring them against `awaitReceiptWithHooks` alone is harmless but they will never fire from this package.

## Lifecycle vocabulary (`TX_STATUS` / `TrackedTx`)

For "in-flight transaction" UIs (toast strips, inline indicators, history panes):

```ts
type TrackedTxStatus =
  | 'preparing'           // pre-wallet (no hash)
  | 'awaiting-signature'  // wallet popup open (no hash)
  | 'pending'             // hash returned, waiting for inclusion
  | 'confirmed'           // receipt arrived, status: success
  | 'failed'              // wallet reject, on-chain revert, or timeout
  | 'dropped'             // never observed in mempool/block (tx-tracker territory)
  | 'replaced'            // different tx mined for same nonce (tx-tracker territory)
```

`TX_FLOW = {} as const` is intentionally empty. Every protocol's flow names (`fulfillIntent`, `addFunds`, `mintNFT`) are its own concern — extend `TxFlow` from your code:

```ts
const MY_FLOW = { addFunds: 'add-funds', mintNFT: 'mint-nft' } as const
type MyFlow = typeof MY_FLOW[keyof typeof MY_FLOW]
// MyFlow extends TxFlow (which is `string`) automatically.
```

Two pre-hash states exist (`preparing`, `awaitingSignature`) so the UI has something to show during gas-estimation + wallet-sign — without them the strip stays blank until after the wallet returns. They carry no `hash` and cannot be receipt-polled.

## Pitfalls (read these)

1. **Forgetting `request` in `awaitReceiptWithHooks`.** It's a required option, not optional, and is what populates `TxContext` on every emitted event. The TS error will catch it but it's an easy field to skip when copy-pasting.

2. **Catching errors without `instanceof` discrimination.** `WalletRejectedError`, `ContractRevertedError`, and unspecified network errors all flow through `onFailed` AND through the helpers' throw paths. Use `instanceof` to map to your SDK's typed errors:
   ```ts
   try { await awaitReceiptWithHooks({ ... }) }
   catch (err) {
     if (err instanceof WalletRejectedError) { /* user rejected */ }
     if (err instanceof ContractRevertedError) { /* on-chain revert; err.receipt for logs */ }
     throw err
   }
   ```

3. **Re-implementing wallet-rejection detection.** The three-signal check (EIP-1193 `code === 4001`, viem class name, message regex, walking the cause chain) lives in `@valve-tech/viem-errors`. `sendTransactionWithHooks` already throws `WalletRejectedError` correctly — don't duplicate the matcher.

4. **Side-channel `hash → request` maps.** Old code that pre-dates rich `TxContext` payloads typically maintained a map from hash to the originating request. With `TxContext`, every event carries `{ chainId, request }` — drop the side channel.

5. **Reading `client.chain?.id` from inside callbacks** when `info.chainId` is already in scope. The whole point of `TxContext` is that the chain ID is part of the event payload; no need to thread the client into the callback.

6. **Wiring `onDropped` / `onReplaced` against this package alone.** They will never fire from `sendTransactionWithHooks` / `awaitReceiptWithHooks`. To get them, attach `@valve-tech/tx-tracker` and let it dispatch into the same `WriteHookParams` shape.

7. **Skipping `includeBlock: false` opt-out** when the consumer doesn't need block data. The default fetches the block once (saving downstream callers an RPC), but if NO downstream cares, that's a wasted round-trip. Only the default if `block?` will be consumed.

8. **Treating `onPhase` and the named hooks as alternatives.** They fire BOTH for every transition — exactly once each. Wiring named hooks doesn't preclude `onPhase` and vice versa. Pick whichever shape fits the consumer (state-machine code likes `onPhase`; React component callbacks like the named hooks).

## Composition with sibling packages

```ts
import { sendTransactionWithHooks, awaitReceiptWithHooks } from '@valve-tech/wallet-adapter'
import { createTxTracker } from '@valve-tech/tx-tracker'

const tracker = createTxTracker({ source, chainId: 1 })

const hash = await sendTransactionWithHooks({
  wallet, request, hooks: { onTransactionHash: ({ hash }) => tracker.track(hash) },
})
const receipt = await awaitReceiptWithHooks({
  publicClient, hash, request, hooks: { /* onConfirmed / onFailed → your UI */ },
})
```

`@valve-tech/tx-flight-react` wraps both helpers for React consumers — if the user wants an in-flight tx strip in a React app, redirect to that package's skill rather than wiring hooks by hand.

## Skills (for AI agents)

`skills/` ships in the npm tarball. If you're an AI agent working in a
project that has installed this package, look in
`node_modules/@valve-tech/wallet-adapter/skills/wallet-adapter-integration/SKILL.md`
for trigger conditions, anti-pattern flags, and recipes for the
helpers' phase wiring.

## Verifying provenance

```bash
npm view @valve-tech/wallet-adapter@latest --json | jq .dist.attestations
npm audit signatures
```

The attestation links the published tarball to the GitHub Actions
workflow run that built it.
