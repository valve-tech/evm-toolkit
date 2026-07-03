---
name: tx-flight-react-integration
description: Integrate `@valve-tech/tx-flight-react` — React UI primitives for an in-flight transaction strip — into a dapp. Use for a "transaction strip", "in-flight transactions" UI, "recent txs" panel; wiring `<TxFlightProvider>` + `useTxFlight` into React 18/19; picking `addWithWalletAdapter` vs `addByHash` (incl. `readOnly` for relayer-observed txs) vs `addManual`; storage adapters (`localStorageAdapter` / `indexedDBAdapter` / `memoryAdapter`); rehydrate via `clientFactory`; or the headless `<TxFlight*>` components (List/Item/StatusIcon/HashLink/Age/Actions). Also fires on imports of `@valve-tech/tx-flight-react`, RSC vs client-component boundaries, multi-instance scoping by `id`, or "why doesn't `addByHash` work" (usually missing optional peer deps). Skip when the user is NOT in React (delegate to wallet-adapter-integration for vanilla JS / SDK code, or tx-tracker-integration for raw tx tracking), or only wants the SDK-side `WriteHookParams` shape without React state (delegate to wallet-adapter-integration).
---

# Integrating `@valve-tech/tx-flight-react`

React UI primitives for an in-flight transaction strip — Provider +
hook + headless components + pluggable storage. Sits on top of
`@valve-tech/wallet-adapter` (lifecycle vocabulary) and
`@valve-tech/tx-tracker` (per-tx state machine), both as **optional**
peer deps. This skill is for AI agents working in a React project that
imports the package.

## Decision tree: which add shape to use

```
How is the user submitting the tx?
├── Through `@valve-tech/wallet-adapter`'s `sendTransactionWithHooks`
│   → use `addWithWalletAdapter`. Sync. Wallet-adapter is types-only
│     imported (no runtime bundle cost). The strip wraps your
│     WriteHookParams so each phase fans to BOTH the user's callback
│     AND a store update.
├── Already have a hash + a viem `PublicClient`
│   → use `addByHash`. Async (tx-tracker + chain-source dynamic-import).
│     Strip builds a private ChainSource + TxTracker; tears down on
│     `flight.remove(id)` or unmount.
│     Tuning knobs: `confirmations` (default 1), `staleAfterBlocks`
│     (default 12), `withReceipts` (fetch receipt at inclusion;
│     surfaces `failed` on revert; +1 RPC).
│     ├── Tx submitted by someone else (relayer, server-observed) but
│     │   you still want live tracking
│     │   → `addByHash` with `readOnly: true` — marks the entry as
│     │     not-yours (no nonce slot held). Pass `submittedAt` when the
│     │     original submit time is known, so the age indicator
│     │     reflects reality instead of starting at add-time.
│     └── Tx is yours (you hold the nonce slot) → plain `addByHash`.
└── Already have a fully-formed `TrackedTx` (server push,
    observed-elsewhere with no client to watch, manually constructed)
    → use `addManual`. Sync. Subsequent updates are caller's
      responsibility (call `addManual` again with same `tx.id`).
```

## How to recognize this package in the user's code

```tsx
import {
  TxFlightProvider,
  useTxFlight,
  TxFlightList,
} from '@valve-tech/tx-flight-react'
import { localStorageAdapter } from '@valve-tech/tx-flight-react/storage'
```

`package.json` will show `@valve-tech/tx-flight-react` at any `0.x` of the toolkit's synced release line. Optional peers (install only if used):
- `@valve-tech/wallet-adapter` — for `addWithWalletAdapter`
- `@valve-tech/tx-tracker` + `@valve-tech/chain-source` — for `addByHash`

## 30-second canonical setup

```tsx
import {
  TxFlightProvider,
  TxFlightList,
  useTxFlight,
} from '@valve-tech/tx-flight-react'

function App() {
  return (
    <TxFlightProvider>
      <Header />
      <TxFlightList />
      <Routes />
    </TxFlightProvider>
  )
}

function SubmitButton() {
  const flight = useTxFlight()
  return (
    <button onClick={async () => {
      await flight.addByHash({ hash, chainId: 1, client: publicClient, flow: 'mint' })
    }}>
      Submit
    </button>
  )
}
```

Defaults: `id="default"`, `localStorageAdapter` (key `tx-flight:default`), `maxItems: 50`, `terminalRetentionMs: 60_000` (1 minute). Storage saves are debounced ~250ms — don't expect a synchronous write per state change.

## Anti-patterns to flag

When reviewing user code, watch for these and suggest fixes:

1. **`useTxFlight()` outside a `<TxFlightProvider>`.** The hook throws on missing provider — that's the deliberate safety check. Wrap your app at the top level. Common cause: rendering the strip in a portal or a sub-tree that's outside the Provider's children.

2. **`addByHash` without installing `@valve-tech/tx-tracker` + `@valve-tech/chain-source`.** They're optional peer deps — the dynamic import will fail at runtime with a module-not-found. Either install both, or use `addManual` for hash-bearing entries (sacrificing the watcher).

3. **Setting `clientFactory` to a closure capturing rendered state.** The factory runs at *Provider mount + per-pending-entry* (during rehydrate), not at render. It must work without depending on React state — typically a module-level `Record<chainId, PublicClient>`:
   ```tsx
   // ✅ stable
   const CLIENTS: Record<number, PublicClient> = {
     1: createPublicClient({ chain: mainnet, transport: http() }),
     369: createPublicClient({ chain: pulsechain, transport: http() }),
   }
   <TxFlightProvider clientFactory={(chainId) => CLIENTS[chainId]} />
   ```

4. **Two `<TxFlightProvider id="default">` mounted at peer locations expecting independent state.** The module-level registry shares stores by `id`. Same id = same store (deliberate for nested layouts). Use distinct ids when you want isolation:
   ```tsx
   <TxFlightProvider id="main">...</TxFlightProvider>
   <TxFlightProvider id="settings">...</TxFlightProvider>
   ```

5. **Expecting `<TxFlightList>` / `<TxFlightAge>` to work without a client boundary.** Both carry `'use client'` (they use hooks), so importing them FROM a React Server Component is legal — Next.js inserts the boundary for you. The real constraints: they need a `<TxFlightProvider>` ancestor (also `'use client'`) and a browser runtime for live state. `<TxFlightStatusIcon>`, `<TxFlightHashLink>`, and `<TxFlightItem>`'s default render path are hook-free and genuinely RSC-safe.

6. **`<TxFlightHashLink>` with a string `explorer` prop.** The prop is a resolver function, `(tx: TrackedTx) => string` — passing `explorer="https://etherscan.io"` is a type error. With no `explorer` at all, it silently degrades to a `<span>` (no link). Correct usage:
   ```tsx
   <TxFlightHashLink tx={tx} explorer={(t) => `https://etherscan.io/tx/${t.hash}`} />
   ```

7. **Custom `TxFlightStorage` adapter that throws on SSR.** If your adapter dereferences `window` / `localStorage` / `indexedDB` without a runtime gate, the server-side render crashes. Built-ins return `null` from `load` and resolve `save` no-op when the runtime is missing. Mirror that pattern.

8. **`JSON.stringify`-ing `TrackedTx` directly in a custom adapter.** `submittedGas` fields are bigints — stringify will throw. The package exports `serialize` / `deserialize` from `'@valve-tech/tx-flight-react/storage'` that hex-encode bigint fields safely. Use those.

9. **Wiring `onDropped` / `onReplaced` against `addWithWalletAdapter` alone.** wallet-adapter doesn't fire those (per its skill). If the user wants them, they need `addByHash` (which uses tx-tracker), or they need to also wire tx-tracker manually.

10. **Persisting state but expecting `preparing` / `awaiting-signature` to resume on reload.** They can't — the wallet popup state isn't recoverable. The strip translates them to `failed` with `notes: 'lost during reload'`. Only `pending` (with hash) and terminal entries survive verbatim.

11. **Wiring `onSpeedUp` / `onCancel` on read-only entries.** A tx added with `addByHash({ readOnly: true, ... })` (relayer-submitted, server-observed) is one the consumer doesn't hold the nonce slot for — a same-nonce replacement can't be signed. The library tracks read-only entries identically; it's YOUR `<TxFlightActions>` wiring that must skip the speed-up/cancel callbacks when `tx.readOnly === true`. Read-site rule: check `tx.readOnly === true` for "read-only" — never `tx.readOnly === false` for "actionable" — because records persisted before the field existed rehydrate with `readOnly: undefined` and must count as actionable. For actionable entries, `useReplaceTransaction(id?)` performs the replacement: `speedUp` / `cancel` wrap `tx-tracker`'s `replaceTransaction` (dynamic-imported) and flip the entry to `replaced` on success. The caller passes the `original` request (the strip doesn't store nonce/calldata) and the bumped `newGas` — compute the bump yourself (see `gas-oracle`); the hook forwards it and does NOT enforce the ~10% node floor. `cancel` builds the 0-value self-send for you.

## Storage adapter selection

| Adapter | Sync? | Default? | Use when |
|---|---|---|---|
| `localStorageAdapter({ keyPrefix? })` | sync | ✓ | Most apps. ~5MB per origin (browser limit). |
| `indexedDBAdapter({ dbName?, storeName? })` | async | — | Larger payloads (history-heavy strips with 100+ items per chain). |
| `memoryAdapter()` | sync | — | Tests, or "explicit no persistence" (the strip resets every reload). |
| Custom (`TxFlightStorage`) | either | — | Server-backed sync (e.g. Supabase per-user persistence), or mirroring to your existing app state. |

## Multi-instance pattern

For nested layouts where the same logical strip mounts in more than one place (e.g. a sticky header + a detail panel), use the same `id` — the module-level registry refCounts so they share state:

```tsx
<TxFlightProvider id="main">
  <Header />
  <Layout>
    <TxFlightProvider id="main">
      <DetailPanel />
    </TxFlightProvider>
  </Layout>
</TxFlightProvider>
```

For genuinely independent strips (different routes, different scopes), use distinct ids:

```tsx
<TxFlightProvider id="trading">...</TxFlightProvider>
<TxFlightProvider id="staking">...</TxFlightProvider>
```

## Rehydrate semantics — the rules

On Provider mount, the storage adapter's `load(id)` runs and persisted entries seed back into state. Per entry:

- `pending` with `hash` AND `clientFactory` is wired → fresh tx-tracker watcher async-attaches via the same internal `ChainSource + TxTracker` machinery.
- `pending` with `hash` but no `clientFactory` → stays `pending` indefinitely. Caller can re-issue `addByHash` to re-arm.
- `pending` without `hash` → impossible by construction; the strip never persists hashless entries past the wallet-sign window.
- `preparing` / `awaiting-signature` → translated to `failed` with `notes: 'lost during reload'`.
- Terminal entries (`confirmed` / `failed` / `dropped` / `replaced`) → preserved verbatim; eviction interval (~5s tick) prunes them past `terminalRetentionMs`.

## Composition with sibling packages

- For the SDK side (define `WriteHookParams`, throw `WalletRejectedError` / `ContractRevertedError`), use `@valve-tech/wallet-adapter` directly. Skill: `wallet-adapter-integration`.
- For per-tx state-machine work without React (vanilla JS, SDK internals), use `@valve-tech/tx-tracker` directly. Skill: `tx-tracker-integration`.
- For sharing a `ChainSource` between multiple derived views (oracle + tracker + strip), see the chain-source skill — but the strip's `addByHash` deliberately uses its OWN private source, decoupled from any shared one. That's intentional; the strip is self-contained.

## Where to find more

- Full API + types: `node_modules/@valve-tech/tx-flight-react/AGENTS.md`
- Human-facing docs: `node_modules/@valve-tech/tx-flight-react/README.md`
- Compiled output: `node_modules/@valve-tech/tx-flight-react/dist/`
- Sibling skills:
  - wallet-adapter-integration for the lifecycle hook contract
  - tx-tracker-integration for the per-tx state machine details
