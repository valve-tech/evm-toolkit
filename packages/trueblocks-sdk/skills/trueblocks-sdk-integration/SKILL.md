---
name: trueblocks-sdk-integration
description: Integrate `@valve-tech/trueblocks-sdk` — typed TS HTTP client to a running TrueBlocks `chifra daemon`. Use when querying historical chain data via chifra verbs (`list`, `export`, `blocks`, `transactions`, `receipts`, `traces`, `logs`, `slurp`, `monitors`, `names`, `abis`, `when`, `state`, `tokens`, `chunks`, `init`, `config`, `status`), picking polymorphic `client.blocks(...)` vs variants like `client.blocks.logs(...)`, "get all transfers for an address", "address appearances", `TrueblocksError`, the `fetch` override, or why `client.send(...)` doesn't exist. Skip when the user wants to SEND transactions (delegate to wallet-adapter-integration — send isn't in the typed surface), wants live in-flight tx tracking (delegate to tx-tracker-integration — trueblocks is historical reads), wants raw RPC block/mempool streams (delegate to chain-source-integration), or has no running chifra daemon and won't install trueblocks-core (the SDK requires it — recommend viem `getLogs` / The Graph / Alchemy instead).
---

# Integrating `@valve-tech/trueblocks-sdk`

Typed TypeScript HTTP client to a running TrueBlocks `chifra daemon`.
Same verb surface as the upstream Go SDK, delivered as `fetch`-based
REST calls. This skill is for AI agents working in a project that
imports the package — especially helping the user pick the right verb
+ variant for what they're trying to read.

## Hard prerequisite — flag this first

The user **must** have a running `chifra daemon` reachable from their
runtime. This package is a CLIENT, not a server. It does NOT bundle,
spawn, or install chifra. If the user doesn't have chifra running,
no amount of TS-side configuration helps.

Before recommending integration code, confirm:
- [ ] User has installed `trueblocks-core` (https://trueblocks.io/docs/install/install-core/).
- [ ] User has indexed the chain(s) they care about (`chifra init`).
- [ ] User has the daemon running (`chifra daemon`) and knows the URL
      it's serving on (default `http://localhost:8080`).

If any of these are unclear, ASK before writing code. A working
client wired to a non-running daemon throws `TrueblocksError` on
every call — frustrating, and the SDK can't help.

## Decision tree: which verb to use

```
What does the user want to know?
├── "Which transactions involve this address?"
│       → client.list({ addrs: [address] })            (lightweight appearances)
│
├── "Full transactions / receipts / logs / transfers / balances for this address"
│       → client.export(...) + the variant they want:
│             .receipts / .logs / .transfers / .balances / .approvals / etc.
│
├── "Block X" / "blocks N..M"
│       → client.blocks({ blocks: [...] }) + variant:
│             .hashes / .logs / .uncles / .traces / .withdrawals / .uniq / .count
│
├── "Transaction by hash"
│       → client.transactions({ transactions: [...] }) + variant:
│             .traces / .uniq / .logs
│
├── "Receipt(s) by hash"
│       → client.receipts({ transactions: [...] })
│
├── "Logs for specific transaction(s)" (filter by emitter / topic)
│       → client.logs({ transactions: [...], emitter?, topic? })
│
├── "Execution traces for transaction(s)"
│       → client.traces({ transactions: [...] }) (+ .count variant)
│
├── "Address history via Etherscan-like 3rd-party API (no local index)"
│       → client.slurp({ addrs: [...] }) (+ .appearances / .count variants)
│
├── "When did block X happen / what block was at timestamp T"
│       → client.when({ blocks: [...] })
│         (`blocks` accepts block numbers, dates, AND timestamps as
│          strings; `timestamps` is a boolean output flag, NOT a
│          lookup input)
│
├── "Read contract state / call view function"
│       → client.state({ addrs, parts }) or client.state.call({ addrs, call })
│
├── "Token balances / transfers"
│       → client.tokens({ addrs, blocks }) or client.export.balances(...)
│
├── "Daemon status / config / chunks"
│       → client.status() / client.config() / client.chunks(...)
│
└── "Send a transaction"
    → NOT in this SDK. Delegate to wallet-adapter-integration.
```

## How to recognize this package in the user's code

```ts
import {
  createTrueblocksClient,
  TrueblocksError,
} from '@valve-tech/trueblocks-sdk'
```

`package.json` will show `@valve-tech/trueblocks-sdk` at any `0.x` of
the toolkit's synced release line. No peer deps.

## Canonical setup

```ts
import { createTrueblocksClient, TrueblocksError } from '@valve-tech/trueblocks-sdk'

const client = createTrueblocksClient({
  baseUrl: process.env.CHIFRA_URL ?? 'http://localhost:8080',
  // optional: pass a custom fetch for retry/auth/logging
  // fetch: myCustomFetch,
})

try {
  // Liveness check: a successful status() call IS the probe — if the
  // daemon is down or unreachable it throws TrueblocksError.
  await client.status()
} catch (err) {
  if (err instanceof TrueblocksError) {
    console.error('chifra error', err.path, err.status, err.message)
  }
  throw err
}
```

## Polymorphic vs variant — the most-likely-to-confuse decision

`client.blocks(...)` (polymorphic) returns a union of every shape the
flag combination COULD produce:

```ts
const result = await client.blocks({ blocks: ['18000000'], logs: true })
// result.data is (Block | LightBlock | Log | Withdrawal | …)[]
// — narrow with a type guard before accessing fields
```

`client.blocks.logs(...)` (variant) preselects the `logs` flag and
narrows to the single concrete shape:

```ts
const result = await client.blocks.logs({ blocks: ['18000000'] })
// result.data is Log[] — no narrowing needed
```

Use the variant when the flag is known at code-time. Use the
polymorphic when flag combinations are computed at runtime (UI toggles,
config-driven queries).

## Anti-patterns to flag

When reviewing user code, watch for these and suggest fixes:

1. **Calling `client.send(...)`.** Doesn't exist. Chifra's send
   surface isn't in the upstream OpenAPI spec, so it's not in the
   typed client. Redirect: use viem / ethers / wagmi or
   `@valve-tech/wallet-adapter` for the write side. Trueblocks is
   read-only history.

2. **No daemon URL guard.** A `createTrueblocksClient({ baseUrl })`
   call to a non-running daemon doesn't fail at construction — it
   fails on the first verb call. Add a `client.status()` probe at
   startup if your code path needs early failure (boot, healthcheck,
   smoke test).

3. **Treating `client.list(...)` results as full transactions.**
   `list` returns *appearances* — lightweight pointers
   (`blockNumber`, `transactionIndex`, `address`). To get full data,
   chain through `client.transactions(...)` or `client.export(...)`:
   ```ts
   const apps = await client.list({ addrs: [address] })
   const txs = await client.transactions({
     transactions: apps.data.map(a => `${a.blockNumber}.${a.transactionIndex}`),
   })
   ```

4. **Polymorphic `client.blocks(...)` when a variant exists.** If
   the flag is known statically, use the variant — narrower types,
   no in-place narrowing required:
   ```ts
   // ❌ then narrows in user code
   const r = await client.blocks({ blocks, logs: true })
   const logs = (r.data as Log[]).filter(...)

   // ✅ already narrowed
   const r = await client.blocks.logs({ blocks })
   r.data.filter(...)
   ```

5. **`client.export(...)` without `addrs`.** Most export variants
   are address-scoped — TS will catch missing `addrs`, but the
   error points at the generated schema. Reframe: "you need to
   pass `addrs: [...]`".

6. **Hand-building URLs to access a missing flag.** The codegen'd
   types reflect the OpenAPI spec at the pinned chifra commit. If
   a flag appears missing, check the spec version — chifra may
   have advanced past the pin. The SDK doesn't expose runtime
   escape-hatch URL building (deliberately, to keep the surface
   typed).

7. **bigint vs string at numeric boundaries.** Generated types
   carry the spec's choice (often `string` for safety — block
   numbers, gas, fees can exceed 2^53). The verb wrappers are a
   pure `response.json()` passthrough — they do NOT convert
   anything at the boundary; what the spec types as `string`
   arrives as `string`. Don't `BigInt(field)` without checking
   the type.

8. **No retry / backoff for flaky daemon connections.** The
   client makes one fetch call per verb. If the daemon is
   intermittent, wrap the call (or pass a `fetch` override that
   retries):
   ```ts
   createTrueblocksClient({
     baseUrl,
     fetch: async (url, init) => {
       for (let attempt = 0; attempt < 3; attempt++) {
         try { return await fetch(url, init) }
         catch (e) { if (attempt === 2) throw e; await sleep(100 * 2**attempt) }
       }
       throw new Error('unreachable')
     },
   })
   ```

9. **Querying chains the daemon hasn't indexed.** chifra serves
   only chains the user has run `chifra init` for. If they ask
   about a new chain (e.g. they indexed mainnet but query
   PulseChain), every call returns empty / errors. Confirm
   indexed chains via `client.config()` if uncertain.

## When to skip this package

- **Sending transactions** — use wallet-adapter / viem / ethers.
- **Live in-flight tx state-machine** — use `@valve-tech/tx-tracker`
  (trueblocks is historical reads, not push observation).
- **Raw block/mempool streams** — use `@valve-tech/chain-source`.
- **No chifra daemon and not installing one** — recommend viem
  `client.getLogs` / The Graph / Alchemy enhanced APIs / Etherscan
  API instead. Don't try to make trueblocks work without its server.

## Where to find more

- Full API + types: `node_modules/@valve-tech/trueblocks-sdk/AGENTS.md`
- Human-facing docs: `node_modules/@valve-tech/trueblocks-sdk/README.md`
- Compiled output: `node_modules/@valve-tech/trueblocks-sdk/dist/`
- Upstream chifra docs: https://trueblocks.io/docs/
- Sibling skills:
  - wallet-adapter-integration for the write/send side
  - tx-tracker-integration for live tx watching
  - chain-source-integration for raw RPC streams
