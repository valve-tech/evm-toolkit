# AGENTS — `@valve-tech/tx-flight-react`

Project-local notes for AI agents touching this package.

## Architectural invariants

1. **Reducers stay pure.** Side effects (start watcher, save storage,
   call unsub) belong in the Provider, not in `addReducer` /
   `updateReducer` / `removeReducer` / `evictReducer`.
2. **Three named add methods, one return type each.** No discriminated
   union, no overloaded `add()`. `addWithWalletAdapter` returns
   `{ id, hooks }`; `addByHash` returns `Promise<string>`; `addManual`
   returns `string`. Don't unify them.
3. **`@valve-tech/tx-tracker` and `@valve-tech/chain-source` are
   dynamic-imported** inside `addByHash`. They are optional peers.
   wallet-adapter-only consumers must not pay the bundle cost.
4. **No `c8 ignore` annotations.** Apply v0.8.x cleanup discipline
   from day 1. If a code path can't be exercised, refactor or delete.
5. **SSR safety.** Every `window` / `document` access guards on
   `typeof globalThis.window !== 'undefined'`. The Provider is
   `'use client'`. Pure renderer components are RSC-safe.
6. **100/100/100/100 coverage gate.** Same as every other package
   in the toolkit.

## File map (final, after all 12 tasks land)

```
src/
├── index.ts                    # public barrel
├── types.ts                    # 3 add-input types, TxFlightStorage
├── store/
│   ├── reducers.ts             # pure functions
│   ├── store.ts                # useSyncExternalStore-backed
│   └── serialize.ts            # bigint-safe JSON for TrackedTx
├── storage/
│   ├── index.ts                # re-exports
│   ├── memory.ts
│   ├── local-storage.ts
│   └── indexed-db.ts
├── integrations/
│   ├── wallet-adapter.ts       # wrapHooks, addWithWalletAdapterImpl
│   └── tx-tracker.ts           # addByHashImpl (dynamic-imports tx-tracker)
├── components/
│   ├── status-icon.tsx
│   ├── hash-link.tsx
│   ├── age.tsx
│   ├── actions.tsx
│   ├── item.tsx
│   └── list.tsx
├── provider.tsx                # TxFlightProvider, context
├── use-tx-flight.ts            # useTxFlight hook
├── ssr.test.ts                 # @vitest-environment node
└── (matching *.test.{ts,tsx} alongside each)
```

## Spec + plan

- Spec: `docs/superpowers/specs/2026-05-07-tx-flight-react-design.md`
- Plan: `docs/superpowers/plans/2026-05-07-tx-flight-react.md`

Read the spec before writing public-API surface; read the plan to find
the per-task scope and verification gates.
