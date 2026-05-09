# AGENTS.md

Terse reference for AI agents (Claude Code, Cursor, Aider, etc.) integrating
`@valve-tech/tx-flight-react`. The full README is for humans; this file is for
agents that need to ground their work in the package's actual surface
quickly.

(For contributor-facing notes — architectural invariants, file map,
test discipline — see `INTERNALS.md` in the package root, not shipped
in the npm tarball.)

## What this package does

React UI primitives for an "in-flight transaction strip" — the pattern
every dapp ends up rebuilding (recently-submitted txs showing
pending → confirmed | failed | dropped | replaced, with a hash link, an
age display, and optional speed-up / cancel). One Provider, one hook,
six headless components, three pluggable storage adapters.

Sits on top of `@valve-tech/wallet-adapter` (lifecycle vocabulary) and
`@valve-tech/tx-tracker` (per-tx state machine). Both are **optional
peer dependencies** — wallet-adapter-only consumers and hash-only
consumers each pay only what they use, because tx-tracker +
chain-source are *dynamic-imported* inside `addByHash`.

React 18 or 19, viem ^2.

## Public API

```ts
// main
import {
  TxFlightProvider,
  useTxFlight,
  TxFlightList,
  TxFlightItem,
  TxFlightStatusIcon,
  TxFlightHashLink,
  TxFlightAge,
  TxFlightActions,
  // type re-exports from wallet-adapter (no runtime import — types only)
  type TrackedTx,
  type TxFlow,
  type WriteHookParams,
} from '@valve-tech/tx-flight-react'

// storage adapters at a sub-export so the default bundle isn't bloated
import {
  localStorageAdapter,
  indexedDBAdapter,
  memoryAdapter,
  type TxFlightStorage,
} from '@valve-tech/tx-flight-react/storage'
```

## Five concepts you must know

| Concept | What it is |
|---|---|
| `<TxFlightProvider id?, storage?, maxItems?, terminalRetentionMs?, onError?, clientFactory?>` | Wraps your React tree. Module-level registry keyed by `id` so multiple Providers with the same id share one store. Default: `id="default"`, `localStorageAdapter` (with `tx-flight:${id}` key prefix), `maxItems: 50`, `terminalRetentionMs: 60_000`. |
| `useTxFlight(id?)` | Hook returning `{ txs, addWithWalletAdapter, addByHash, addManual, remove, clear, get }`. Throws if no Provider for the resolved id is in the tree. |
| Three add shapes | `addWithWalletAdapter` (sync, returns `{ id, hooks }`), `addByHash` (async, returns `Promise<string>`), `addManual` (sync, returns `string`). One return type each — no overloaded discriminated union. |
| Storage adapters | Two-method `TxFlightStorage` interface (`load(id) → Promise<TrackedTx[] \| null>`, `save(id, txs) → Promise<void>`). Three built-ins; consumers can implement their own. |
| Rehydrate | On mount, persisted entries seed back into state. `pending` with `hash` + `clientFactory` → fresh tx-tracker watcher async-attaches. `pending` without `clientFactory` → stays pending. `preparing`/`awaiting-signature` → translated to `failed` with `notes: 'lost during reload'`. |

## The three add shapes — pick by how you got the tx

### `addWithWalletAdapter` — for `@valve-tech/wallet-adapter` consumers

Sync. Wallet-adapter is statically imported (types only — no runtime bundle cost):

```tsx
import { sendTransactionWithHooks } from '@valve-tech/wallet-adapter'
import { useTxFlight } from '@valve-tech/tx-flight-react'

const flight = useTxFlight()
const { id, hooks } = flight.addWithWalletAdapter({
  hooks: { onConfirmed: (info) => myToast(`tx ${info.hash} confirmed`) },
  flow: 'mint',
  chainId: 1,
  request: { to: contract, data, value: 0n, chainId: 1 },
})
// `hooks` is wrapped — every phase fires BOTH your callback AND a store update.
await sendTransactionWithHooks({ wallet, request, hooks })
```

### `addByHash` — when you have a hash + `PublicClient`

Async — `@valve-tech/tx-tracker` and `@valve-tech/chain-source` are **dynamic-imported**, so consumers who never call `addByHash` don't ship those packages. The strip builds a private `ChainSource + TxTracker` internally; `flight.remove(id)` (or unmount) cleans up the subscription.

```tsx
const id = await flight.addByHash({
  hash: '0xabc...',
  chainId: 1,
  client: publicClient,
  flow: 'claim',
  withReceipts: true,
  confirmations: 3,
})
```

### `addManual` — when you already have a `TrackedTx`

Sync. Useful for back-fill (server push, observed-elsewhere txs). Subsequent updates are the consumer's responsibility (call `addManual` again with the same `tx.id` to overwrite, or `flight.remove(id)`).

## Components — what's RSC-safe

| Component | RSC-safe | Notes |
|---|---|---|
| `<TxFlightProvider>` | no | `'use client'`. Owns state + storage + eviction interval + watchers. |
| `<TxFlightList>` | no | Uses `useTxFlight`. Defaults to newest-first by `submittedAt`. Optional `filter` / `sort` / `render` / `empty`. |
| `<TxFlightItem>` | yes | Default per-tx layout (icon + hash + age + actions). `render` swaps the layout while keeping the four atomic children. |
| `<TxFlightStatusIcon>` | yes | Colored dot per status. `size` (default 16). |
| `<TxFlightHashLink>` | yes | `<a>` to explorer (or `<span>` fallback when no `explorer` prop). Truncation: `'middle'` \| `'end'` \| `'none'`. |
| `<TxFlightAge>` | no | Uses `useEffect` for periodic relative-time. `format` swaps wording. |
| `<TxFlightActions>` | yes | Speed-up / cancel / dismiss button slots. Renders nothing when no callbacks wired. |

Every component accepts `className` and `style`.

## Storage adapters

| Adapter | When to use |
|---|---|
| `localStorageAdapter({ keyPrefix? })` | Default. Sync API; SSR-safe (no-op when `window === undefined`). |
| `indexedDBAdapter({ dbName?, storeName? })` | Larger payloads, async. SSR-safe (no-op when `indexedDB === undefined`). |
| `memoryAdapter()` | Tests, or "explicit no persistence". |

Custom adapter just satisfies `TxFlightStorage`. The serializer that the built-ins use is exported as `serialize` / `deserialize` from `'@valve-tech/tx-flight-react/storage'` — bigint-safe (hex-encodes `submittedGas` fields).

## Pitfalls (read these)

1. **Calling `useTxFlight()` outside a `<TxFlightProvider>`.** The hook throws — this is the deliberate "no provider in tree" safety check. Wrap your app at the top level, or render-prop the strip into a sub-tree where the Provider lives.

2. **Calling `addByHash` without installing `@valve-tech/tx-tracker` + `@valve-tech/chain-source`.** They're optional peer deps — the dynamic import will fail at runtime. Either install both or use `addManual`/`addWithWalletAdapter` only.

3. **Expecting `preparing` / `awaiting-signature` entries to survive a reload.** They can't — the wallet popup state isn't recoverable. Persisted entries in those statuses get translated to `failed` with `notes: 'lost during reload'`. Only `pending` (with `hash`) and terminal entries survive verbatim.

4. **Setting `clientFactory` to a closure that captures stale state.** The factory is called at *rehydrate time* (Provider mount, after a reload) per pending entry's `chainId`. It must work without depending on rendered state — typically a module-level `Record<chainId, PublicClient>`.

5. **Two `<TxFlightProvider id="default">` in the same tree expecting independent state.** The module-level registry shares stores by `id` — same id means same store (intentional for nested layouts). Use distinct ids for distinct strips.

6. **`<TxFlightHashLink>` with no `explorer` prop.** It silently degrades to a `<span>` (no link). If you want a link, pass `explorer="https://etherscan.io"` (or wrap with your own resolver per chainId).

7. **Rendering `<TxFlightAge>` or `<TxFlightList>` from an RSC.** Both use hooks. Use `<TxFlightItem>` / `<TxFlightStatusIcon>` / `<TxFlightHashLink>` / `<TxFlightActions>` for RSC-safe rendering with server-resolved data.

8. **Custom `TxFlightStorage` adapter without SSR no-op.** If your adapter throws when `window === undefined`, server-side rendering crashes. Mirror the built-ins — return `null` from `load` and resolve `save` no-op when the runtime gate is missing.

9. **Persisting state with bigints and using `JSON.stringify` directly.** The package's serializer hex-encodes `submittedGas` fields so the payload is JSON-safe. If you implement a custom adapter, use the exported `serialize` / `deserialize` rather than rolling your own.

10. **Wiring `onDropped` / `onReplaced` against `addWithWalletAdapter` and expecting them to fire from wallet-adapter alone.** wallet-adapter doesn't fire those — they need tx-tracker. If you want them, use `addByHash` (or use both add shapes for the same tx).

## Composition

- `addWithWalletAdapter` produces wrapped hooks for `sendTransactionWithHooks` — that's the canonical wallet-adapter path. The wrapper fans every phase to BOTH the user's hook AND a store update.
- `addByHash` builds a private `ChainSource + TxTracker` per strip. If the user already has a shared `ChainSource`/`TxTracker` for other purposes (e.g. a gas-oracle integration), they're decoupled — the strip's tracker is its own.
- `flight.remove(id)` synchronously removes the entry AND tears down any tracker watcher attached for it. Same on Provider unmount.

## Skills (for AI agents)

`skills/` ships in the npm tarball. If you're an AI agent working in a
project that has installed this package, look in
`node_modules/@valve-tech/tx-flight-react/skills/tx-flight-react-integration/SKILL.md`
for trigger conditions, anti-pattern flags, and integration recipes.

## Verifying provenance

```bash
npm view @valve-tech/tx-flight-react@latest --json | jq .dist.attestations
npm audit signatures
```
