---
name: wallet-adapter-integration
description: Integrate `@valve-tech/wallet-adapter` — framework-agnostic vocabulary for EVM wallet integration — into an SDK, dapp, or in-flight tx UI. Use when the user is wiring up `sendTransactionWithHooks` or `awaitReceiptWithHooks`, defining a `WalletAdapter` to decouple their SDK from wagmi/ethers/viem-direct/smart-account, building a transaction-status UI on top of `TX_STATUS` / `TrackedTx`, or asks "how do I detect wallet rejection vs on-chain revert" (`WalletRejectedError` vs `ContractRevertedError` instanceof discrimination). Also fires on imports of `@valve-tech/wallet-adapter` and questions about the `WriteHookParams` lifecycle (`onAwaitingSignature`, `onTransactionHash`, `onConfirmed`, `onFailed`, `onDropped`, `onReplaced`), the `onPhase` discriminated-union shape, the `TxContext` info bag (`{ chainId, request }` carried on every event), `WritePhaseSteps` declaration merging, the `includeBlock` block-fetch toggle, or composing the helpers with `@valve-tech/tx-tracker` (which fires the `onDropped`/`onReplaced` hooks the helpers themselves don't fire). Skip when the user wants per-tx state-machine work without the wallet helpers (delegate to tx-tracker-integration), wants a ready-made React UI for in-flight txs (delegate to tx-flight-react-integration — that package wraps these helpers), or only wants to detect viem error shapes without the helpers (delegate to viem-errors-integration).
---

# Integrating `@valve-tech/wallet-adapter`

Framework-agnostic vocabulary for EVM dapp wallet integration: pure
types + a few `as const` lifecycle constants + two thin helpers
(`sendTransactionWithHooks` for the wallet side,
`awaitReceiptWithHooks` for the chain side). The whole point: every
SDK / dapp / UI in your stack speaks the same wallet shape, the same
phases, the same in-flight tx vocabulary — no bespoke "awaiting
signature" state machine per integration.

## Decision tree: which surface to use

```
Is the user building an SDK that needs to accept ANY wallet
(wagmi, ethers, viem-direct, smart account, custom)?
├── Yes — accept `WalletAdapter` as a constructor arg. Define an adapter
│         once per consumer (one for wagmi, one for ethers, etc.) and
│         your SDK stays decoupled from the wallet library.
└── No — does the user have one specific wallet library and just wants
         the lifecycle hooks?
         ├── Yes — call `sendTransactionWithHooks` + `awaitReceiptWithHooks`
         │         directly. Pass your wallet-library's send/wait
         │         function via `wallet` / `publicClient`. The helpers
         │         do the phase wiring; you handle protocol-specific work
         │         in between.
         └── No — does the user want an in-flight tx UI strip (React)?
                  └── Yes — redirect to `@valve-tech/tx-flight-react`
                            (it wraps these helpers + adds React state).
```

## How to recognize this package in the user's code

```ts
import {
  sendTransactionWithHooks,
  awaitReceiptWithHooks,
  WalletRejectedError,
  ContractRevertedError,
  TX_STATUS,
  type WalletAdapter,
  type WriteHookParams,
  type TxContext,
} from '@valve-tech/wallet-adapter'
```

`package.json` will show `"@valve-tech/wallet-adapter": "^0.10.x"`.

## The two-helper pattern (canonical SDK shape)

```ts
import {
  sendTransactionWithHooks,
  awaitReceiptWithHooks,
  WalletRejectedError,
  ContractRevertedError,
  type WalletAdapter,
  type WriteHookParams,
} from '@valve-tech/wallet-adapter'

export class MyClient {
  constructor(
    private wallet: WalletAdapter,
    private publicClient: PublicClient,
    private chainId: number,
  ) {}

  async deposit(params: DepositParams & WriteHookParams) {
    const request = {
      to: this.escrow,
      data: this.encodeDeposit(params),
      chainId: this.chainId,
    }
    try {
      const hash    = await sendTransactionWithHooks({ wallet: this.wallet, request, hooks: params })
      const receipt = await awaitReceiptWithHooks({ publicClient: this.publicClient, hash, request, hooks: params })
      // protocol-specific work here (decode logs, etc.) — onConfirmed already fired
      return { hash, receipt }
    } catch (err) {
      if (err instanceof WalletRejectedError) throw new MySdkError('WALLET_REJECTED', err.message, err.cause)
      if (err instanceof ContractRevertedError) throw new MySdkError('TX_REVERTED', err.message, err)
      throw err
    }
  }
}
```

Two splits, on purpose: the wallet side and the chain side. Protocol-specific work (gating-service signatures, log decoding, indexer sync) goes between the two helpers. Each helper fires its own subset of `WriteHookParams` callbacks.

## What each helper fires

`sendTransactionWithHooks` fires:
- **once** before wallet popup: `onAwaitingSignature` + `onPhase('awaiting-signature')`
- **once** after hash returned: `onTransactionHash` (per-call AND any global one passed) + `onPhase('pending', { hash })`
- **once** on rejection: `onFailed({ error: WalletRejectedError })` + `onPhase('failed', ...)`, then **throws** `WalletRejectedError`
- **once** on any other thrown error: `onFailed({ error: <thrown> })` + `onPhase('failed', ...)`, then re-throws unchanged

`awaitReceiptWithHooks` fires (must pass `request` — it populates `TxContext`):
- on `status: success`: fetches containing block (unless `includeBlock: false`), then `onConfirmed({ hash, receipt, block? })` + `onPhase('confirmed', ...)`
- on `status: reverted`: fetches block, then `onFailed({ hash, receipt, block?, error: ContractRevertedError })` + `onPhase('failed', ...)`, **throws** `ContractRevertedError`
- on network/RPC/abort: `onFailed({ error: <thrown> })` (no hash/receipt/block) + `onPhase('failed', ...)`, re-throws unchanged

**Neither helper fires `onDropped` or `onReplaced`.** Those are part of the `WriteHookParams` contract but require multi-block observation + nonce-watching — that's `@valve-tech/tx-tracker`'s job. The hooks live here so consumers wire **one** set of callbacks.

## Anti-patterns to flag

When reviewing user code, watch for these and suggest fixes:

1. **Catching errors without `instanceof` discrimination.** All three error classes (`WalletRejectedError`, `ContractRevertedError`, generic `Error`) flow through `onFailed` AND through the throw paths. Without `instanceof`, the SDK can't map them to its own typed errors:
   ```ts
   // ❌ loses the discrimination
   try { ... } catch (err) { throw new MyError(err.message) }

   // ✅ preserves it
   try { ... } catch (err) {
     if (err instanceof WalletRejectedError) throw new MyError('REJECTED', err.cause)
     if (err instanceof ContractRevertedError) throw new MyError('REVERTED', err.receipt)
     throw err
   }
   ```

2. **Re-implementing wallet-rejection detection.** The three-signal check (EIP-1193 `code === 4001`, viem class name, message regex, walking the cause chain) lives in `@valve-tech/viem-errors`. `sendTransactionWithHooks` already throws `WalletRejectedError` correctly — don't duplicate the matcher.

3. **Side-channel `hash → request` maps in callbacks.** Old code that pre-dates `TxContext` typically maintains a map from hash to the originating request. Every event now carries `{ chainId, request }` in its info bag — drop the side channel:
   ```ts
   // ❌ legacy
   const requestByHash = new Map<Hex, Request>()
   onTransactionHash: (hash) => requestByHash.set(hash, request)
   onConfirmed: (receipt) => doThing(requestByHash.get(receipt.transactionHash), receipt)

   // ✅ current
   onConfirmed: (info) => doThing(info.request, info.receipt)
   ```

4. **Reading `client.chain?.id` from inside callbacks** when `info.chainId` is in scope. Drop the client capture — `TxContext` already has it.

5. **Forgetting `request` in `awaitReceiptWithHooks`.** Required option (TS will catch it), but easy to skip when copy-pasting from older examples that didn't have `TxContext`.

6. **Wiring `onDropped` / `onReplaced` and expecting them to fire from these helpers.** They won't — they're part of the contract but live behind tx-tracker. Either accept they're silent (stub them out) or attach tx-tracker to dispatch them.

7. **`includeBlock: true` (the default) when no downstream cares about the block.** The default fetches the containing block to amortize the round-trip across consumers; if no consumer reads `block`, that's wasted RPC. Pass `includeBlock: false` explicitly.

8. **Wrapping `sendTransactionWithHooks` in another `try/catch` that swallows the throw.** The helpers fire `onFailed` AND throw — the throw is the SDK's signal to halt the rest of the pipeline. Swallowing it means `awaitReceiptWithHooks` runs with an undefined hash.

9. **Treating `onPhase` and the named hooks as alternatives.** They fire BOTH for every transition — exactly once each. Wiring named hooks doesn't preclude `onPhase`. Use whichever fits the consumer (state-machine code prefers `onPhase`; React component callbacks like the named hooks).

10. **Hardcoding `TX_STATUS` strings instead of using the const.** `tx.status === 'mined'` won't typecheck — the constant is `'confirmed'`. Use `tx.status === TX_STATUS.confirmed` so renames propagate.

## Defining a `WalletAdapter`

When the user is writing an adapter for a specific wallet library, the
shape is:

```ts
import type { WalletAdapter } from '@valve-tech/wallet-adapter'

const wagmiAdapter = (config: WagmiConfig): WalletAdapter => ({
  get address() { return getAccount(config).address },
  sendTransaction: async (req) => {
    return sendTransaction(config, {
      to: req.to, data: req.data, value: req.value, chainId: req.chainId,
      maxFeePerGas: req.maxFeePerGas, maxPriorityFeePerGas: req.maxPriorityFeePerGas,
    })
  },
  // readContract is optional — only implement if your SDK uses it
})
```

The `WalletAdapter` interface is intentionally minimal — `sendTransaction` is the only required method. `readContract` is optional for SDKs that need wallet-side reads (account-bound contracts, signature checks).

## Composing with tx-tracker (gets you `onDropped` / `onReplaced`)

```ts
import { createTxTracker } from '@valve-tech/tx-tracker'
import { sendTransactionWithHooks, awaitReceiptWithHooks } from '@valve-tech/wallet-adapter'

const tracker = createTxTracker({ source, chainId: 1 })

const hash = await sendTransactionWithHooks({
  wallet, request,
  hooks: {
    onTransactionHash: ({ hash }) => tracker.track(hash, {
      onDropped:  () => userHooks.onDropped?.({ chainId: request.chainId, request, hash }),
      onReplaced: ({ replacement }) => userHooks.onReplaced?.({
        chainId: request.chainId, request, original: hash, replacement,
      }),
    }),
  },
})
```

For per-tx state-machine work (subscribe by hash, watch for replacement, detect drops, reorg-safety), redirect to the tx-tracker integration skill at `node_modules/@valve-tech/tx-tracker/skills/tx-tracker-integration/SKILL.md`.

For React in-flight tx UIs, redirect to `@valve-tech/tx-flight-react` — it wraps these helpers + `tx-tracker` into a Provider + headless components.

## In-flight UI on `TX_STATUS`

```ts
import { TX_STATUS, type TrackedTx } from '@valve-tech/wallet-adapter'

function subtitle(tx: TrackedTx): string {
  switch (tx.status) {
    case TX_STATUS.preparing:         return 'preparing transaction'
    case TX_STATUS.awaitingSignature: return 'awaiting wallet signature'
    case TX_STATUS.pending:           return 'waiting for inclusion'
    case TX_STATUS.confirmed:         return 'confirmed on-chain'
    case TX_STATUS.failed:            return tx.notes ?? 'transaction failed'
    case TX_STATUS.dropped:           return 'dropped from mempool'
    case TX_STATUS.replaced:          return 'replaced by speed-up'
  }
}
```

Pre-hash states (`preparing`, `awaitingSignature`) carry no `hash` — they exist so the strip has something to show during gas-estimation + wallet-sign.

## Where to find more

- Full API + types: `node_modules/@valve-tech/wallet-adapter/AGENTS.md`
- Human-facing docs: `node_modules/@valve-tech/wallet-adapter/README.md`
- Compiled output (when types alone aren't enough): `node_modules/@valve-tech/wallet-adapter/dist/`
- Sibling skills:
  - tx-tracker for the `onDropped`/`onReplaced` firing path
  - tx-flight-react for React in-flight UI
  - viem-errors for the wallet-rejection discriminator internals
