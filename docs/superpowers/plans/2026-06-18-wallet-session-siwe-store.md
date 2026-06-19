# Replace `auth-lite` with `wallet-key-session` + `siwe-store` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant `@valve-tech/auth-lite` package, ship two focused stateful packages (`@valve-tech/wallet-key-session`, browser; `@valve-tech/siwe-store`, server) that fill the gaps `viem/siwe` deliberately leaves, and rework `examples/encrypted-vault` to use `viem/siwe` directly (full EIP-4361) while dogfooding both new packages.

**Architecture:** `viem/siwe` already owns the SIWE crypto/message/validation core, so `auth-lite` (a thin wrapper) is deleted. The two new packages own only the *stateful* gaps: `wallet-key-session` owns the memory-only lifecycle of a wallet-derived encryption key (pairs `@valve-tech/wallet-crypto`); `siwe-store` owns the single-use nonce store + opaque session issuance (pairs `viem/siwe`). The example wires `viem/siwe` for auth and both new packages for state.

**Tech Stack:** TypeScript (NodeNext ESM), viem (`viem/siwe` + `recoverMessageAddress`), WebCrypto (`CryptoKey`), Node `node:crypto`, Vitest, React 18 + Vite 5 + plain `node:http` (the example), TypeDoc (docs artifacts).

## Global Constraints

These apply to **every** task. Copy values verbatim.

- **Source spec:** `docs/superpowers/specs/2026-06-15-wallet-session-siwe-store-design.md`. Read it before starting; this plan implements it.
- **Synced version:** both new packages are created at version **`0.18.0`** (the current synced version of every workspace package). The lockstep bump to the next version is a separate release step (`.claude/skills/releasing-evm-toolkit/SKILL.md`) and is OUT OF SCOPE here.
- **Package shape (mirror `packages/wallet-crypto/` exactly):** every new package ships `package.json`, `tsconfig.json`, `src/` (code + colocated `*.test.ts`), `examples/` (numbered `.ts` + `examples/tsconfig.json`), `skills/<name>-integration/SKILL.md`, `README.md`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`. No `.npmignore`, no `vitest.config.ts` (the repo has neither for `wallet-crypto`; the `files` allowlist in `package.json` is the publish boundary and Vitest uses its zero-config default).
- **`files` allowlist (verbatim):** `["dist", "skills", "README.md", "AGENTS.md", "CHANGELOG.md", "LICENSE"]`.
- **Browser-safe rule:** `@valve-tech/wallet-key-session/src/` must NOT import any `node:*` module, `fs`, `path`, `events`, etc. Guard `window` access with `typeof window !== 'undefined'`. (`@valve-tech/siwe-store` is a server package and MAY use `node:crypto`.)
- **Import extensions:** intra-package imports use `.js` (e.g. `from './key-session.js'`) — NodeNext ESM. Cross-package imports use the package name, never relative paths.
- **No `any` in `src/`** (lint error). JSDoc on every export. One responsibility per file. `index.ts` re-exports only — no logic.
- **Peer dep (verbatim):** `"viem": "^2.0.0"`. Neither new package has any `dependencies` (the consumer injects `derive` into `wallet-key-session`; `siwe-store` uses only `viem/siwe` + `node:crypto`).
- **Never edit historical CHANGELOG entries.** Add new `## [Unreleased]` sections; leave every existing `[0.18.0]`/older section (in the root and per-package CHANGELOGs) untouched.
- **Verification gates (run from repo root):** `yarn build`, `yarn lint`, `yarn typecheck`, `yarn typecheck:examples`, `yarn test`, `yarn verify:clean`, `yarn verify:release-coverage`, `yarn docs:check`. CI (`.github/workflows/ci.yml`) runs `docs:check`, so `docs/api/` must be regenerated and committed.
- **Release coupling:** `scripts/verify-release-coverage.mjs` asserts every non-private `packages/*` has a `Publish <pkg.name>` step in `.github/workflows/release.yml`. Add steps for new packages; remove `auth-lite`'s.

---

### Task 1: Create `@valve-tech/wallet-key-session` (browser, memory-only key lifecycle)

**Files:**
- Create: `packages/wallet-key-session/package.json`
- Create: `packages/wallet-key-session/tsconfig.json`
- Create: `packages/wallet-key-session/src/key-session.ts`
- Create: `packages/wallet-key-session/src/index.ts`
- Test:   `packages/wallet-key-session/src/key-session.test.ts`
- Create: `packages/wallet-key-session/examples/01-key-session-lifecycle.ts`
- Create: `packages/wallet-key-session/examples/tsconfig.json`
- Create: `packages/wallet-key-session/skills/wallet-key-session-integration/SKILL.md`
- Create: `packages/wallet-key-session/README.md`
- Create: `packages/wallet-key-session/AGENTS.md`
- Create: `packages/wallet-key-session/CHANGELOG.md`
- Create: `packages/wallet-key-session/LICENSE` (copied from `packages/wallet-crypto/LICENSE`)
- Modify: `.github/workflows/release.yml` (add Publish step)
- Modify: `package.json` (root — add to `typecheck:examples`)

**Interfaces:**
- Consumes: nothing from other tasks. `viem` peer for the `Address` type.
- Produces (Task 4 relies on these exact names/types):
  - `createKeySession(opts: { address: Address; derive: () => Promise<CryptoKey>; provider?: Eip1193Like; clearOnPageHide?: boolean }): KeySession`
  - `interface KeySession { readonly address: Address; getKey(): Promise<CryptoKey>; clear(): void }`
  - `interface Eip1193Like { on?(event: string, handler: (...args: unknown[]) => void): void; removeListener?(event: string, handler: (...args: unknown[]) => void): void }`

- [ ] **Step 1: Create the package manifest**

`packages/wallet-key-session/package.json`:

```json
{
  "name": "@valve-tech/wallet-key-session",
  "version": "0.18.0",
  "description": "Memory-only lifecycle for a wallet-derived encryption key in viem-based dapps. Derives the (non-extractable) CryptoKey once per session, never persists it, and wipes it on disconnect / account-change / tab-close. Pairs @valve-tech/wallet-crypto. The derivation itself is injected, so the lifecycle is unit-testable without a wallet. Browser-safe — no node imports, no persistent storage. Part of the valve-tech/evm-toolkit synchronized release line.",
  "license": "MIT",
  "homepage": "https://github.com/valve-tech/evm-toolkit/tree/main/packages/wallet-key-session#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/valve-tech/evm-toolkit.git",
    "directory": "packages/wallet-key-session"
  },
  "bugs": {
    "url": "https://github.com/valve-tech/evm-toolkit/issues"
  },
  "keywords": [
    "ethereum",
    "evm",
    "viem",
    "wallet",
    "encryption",
    "key-lifecycle",
    "session",
    "cryptokey",
    "memory-only",
    "browser"
  ],
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "skills",
    "README.md",
    "AGENTS.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc -p .",
    "typecheck": "tsc -p . --noEmit",
    "typecheck:examples": "tsc -p examples",
    "lint": "eslint src",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "prepare": "yarn build"
  },
  "peerDependencies": {
    "viem": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create the tsconfig** (browser — needs the `DOM` lib for `CryptoKey` / `window`)

`packages/wallet-key-session/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2020", "DOM"]
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Write the failing test**

`packages/wallet-key-session/src/key-session.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createKeySession, type Eip1193Like } from './key-session.js'

const ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const

/** A throwaway non-extractable AES-GCM key — stands in for a derived key. */
async function makeKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new Uint8Array(32),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** A fake EIP-1193 provider whose events we can fire by hand. */
function fakeProvider(): { provider: Eip1193Like; fire: (event: string) => void } {
  const handlers: Record<string, Array<(...a: unknown[]) => void>> = {}
  return {
    provider: { on: (e, h) => { (handlers[e] ??= []).push(h) } },
    fire: (e) => { for (const h of handlers[e] ?? []) h() },
  }
}

describe('createKeySession', () => {
  it('derives the key exactly once across multiple and concurrent getKey() calls', async () => {
    const derive = vi.fn(makeKey)
    const ks = createKeySession({ address: ADDR, derive, clearOnPageHide: false })
    const [a, b] = await Promise.all([ks.getKey(), ks.getKey()])
    const c = await ks.getKey()
    expect(derive).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(a).toBe(c)
    expect(ks.address).toBe(ADDR)
  })

  it('clear() forces the next getKey() to re-derive', async () => {
    const derive = vi.fn(makeKey)
    const ks = createKeySession({ address: ADDR, derive, clearOnPageHide: false })
    await ks.getKey()
    ks.clear()
    await ks.getKey()
    expect(derive).toHaveBeenCalledTimes(2)
  })

  it('clears the key when the provider fires accountsChanged', async () => {
    const derive = vi.fn(makeKey)
    const { provider, fire } = fakeProvider()
    const ks = createKeySession({ address: ADDR, derive, provider, clearOnPageHide: false })
    await ks.getKey()
    fire('accountsChanged')
    await ks.getKey()
    expect(derive).toHaveBeenCalledTimes(2)
  })

  it('clears the key when the provider fires chainChanged', async () => {
    const derive = vi.fn(makeKey)
    const { provider, fire } = fakeProvider()
    const ks = createKeySession({ address: ADDR, derive, provider, clearOnPageHide: false })
    await ks.getKey()
    fire('chainChanged')
    await ks.getKey()
    expect(derive).toHaveBeenCalledTimes(2)
  })

  it('does not cache a rejected derivation — the next getKey() retries', async () => {
    const derive = vi
      .fn<() => Promise<CryptoKey>>()
      .mockRejectedValueOnce(new Error('declined'))
      .mockImplementation(makeKey)
    const ks = createKeySession({ address: ADDR, derive, clearOnPageHide: false })
    await expect(ks.getKey()).rejects.toThrow('declined')
    await expect(ks.getKey()).resolves.toBeDefined()
    expect(derive).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `yarn workspace @valve-tech/wallet-key-session test`
Expected: FAIL — `Cannot find module './key-session.js'` (the source doesn't exist yet).

- [ ] **Step 5: Write the implementation**

`packages/wallet-key-session/src/key-session.ts`:

```ts
/**
 * @fileoverview Memory-only lifecycle for a wallet-derived encryption key.
 *
 * The CryptoKey lives ONLY in a closure variable — it is never written
 * to localStorage / sessionStorage / IndexedDB / cookies. `getKey()`
 * memoizes the in-flight derivation promise so `derive` runs once even
 * under concurrent callers; `clear()` and any
 * `accountsChanged` / `chainChanged` / `pagehide` event drop the
 * reference so the next `getKey()` re-derives (re-prompting the wallet).
 *
 * The derivation is injected (the `derive` callback), so this lifecycle
 * is unit-testable without a wallet and stays decoupled from
 * `@valve-tech/wallet-crypto` — the consumer wires the two together.
 */

import type { Address } from 'viem'

/** A live, memory-only handle to a wallet-derived encryption key. */
export interface KeySession {
  /** The address the key is bound to. */
  readonly address: Address
  /**
   * Lazily derive the key once; cache the (non-extractable) CryptoKey
   * in memory only. Concurrent calls share one in-flight derivation. A
   * rejected derivation is NOT cached — the next call retries.
   */
  getKey(): Promise<CryptoKey>
  /** Drop the cached key reference (e.g. on sign-out). */
  clear(): void
}

/** The slice of an EIP-1193 provider this package listens on. */
export interface Eip1193Like {
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

/**
 * Create a memory-only key session.
 *
 * @example
 * ```ts
 * const session = createKeySession({
 *   address,
 *   derive: () => deriveWalletEncryptionKey({ signer, purpose: 'notes-vault', version: 1 }),
 *   provider: window.ethereum,
 * })
 * const key = await session.getKey() // first call prompts the wallet
 * ```
 */
export function createKeySession(opts: {
  /** The address the key is bound to. */
  address: Address
  /**
   * Wire the actual derivation here, e.g.
   * `() => deriveWalletEncryptionKey({ signer, purpose, version })`.
   * Injectable so the session is unit-testable without a wallet.
   */
  derive: () => Promise<CryptoKey>
  /** If supplied, auto-`clear()` on `accountsChanged` / `chainChanged`. */
  provider?: Eip1193Like
  /** Default `true`: also `clear()` on `pagehide` (tab close / bfcache evict). */
  clearOnPageHide?: boolean
}): KeySession {
  let cached: Promise<CryptoKey> | null = null

  const clear = (): void => {
    cached = null
  }

  // Wallet identity changed under us — the prior key is no longer valid.
  opts.provider?.on?.('accountsChanged', clear)
  opts.provider?.on?.('chainChanged', clear)

  // Drop the key when the page is going away. Guarded so the package
  // stays import-safe in non-DOM runtimes (SSR, tests).
  const clearOnPageHide = opts.clearOnPageHide ?? true
  if (
    clearOnPageHide &&
    typeof window !== 'undefined' &&
    typeof window.addEventListener === 'function'
  ) {
    window.addEventListener('pagehide', clear)
  }

  return {
    address: opts.address,
    getKey(): Promise<CryptoKey> {
      // Assigning synchronously before the first await is what makes
      // concurrent callers share one derivation. The `.catch` clears
      // the cache on failure so a declined prompt can be retried.
      cached ??= opts.derive().catch((err: unknown) => {
        cached = null
        throw err
      })
      return cached
    },
    clear,
  }
}
```

- [ ] **Step 6: Write the public entry point**

`packages/wallet-key-session/src/index.ts`:

```ts
/**
 * @fileoverview Public API of `@valve-tech/wallet-key-session`.
 *
 * Memory-only lifecycle for a wallet-derived encryption key. Pairs
 * `@valve-tech/wallet-crypto` (wire its `deriveWalletEncryptionKey`
 * into the `derive` callback).
 */

export { createKeySession } from './key-session.js'
export type { KeySession, Eip1193Like } from './key-session.js'
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `yarn workspace @valve-tech/wallet-key-session test`
Expected: PASS — 5 tests green.

- [ ] **Step 8: Create the example + its tsconfig**

`packages/wallet-key-session/examples/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": false
  },
  "include": ["**/*.ts"]
}
```

`packages/wallet-key-session/examples/01-key-session-lifecycle.ts`:

```ts
/**
 * 01 — The memory-only key session lifecycle.
 *
 * Shows derive-once + auto-clear without a real wallet: the `derive`
 * callback and the EIP-1193 `provider` are both injectable, so we
 * stand in a throwaway key and a fake provider. In a browser app,
 * `derive` would call `deriveWalletEncryptionKey` from
 * `@valve-tech/wallet-crypto` and `provider` would be `window.ethereum`.
 *
 * Run with: yarn tsx packages/wallet-key-session/examples/01-key-session-lifecycle.ts
 */

import { createKeySession, type Eip1193Like } from '../src/index.js'

const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

let derivations = 0
async function fakeDerive(): Promise<CryptoKey> {
  derivations++
  return crypto.subtle.importKey('raw', new Uint8Array(32), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

// Fake provider so we can fire accountsChanged by hand.
const handlers: Record<string, Array<(...a: unknown[]) => void>> = {}
const provider: Eip1193Like = { on: (e, h) => { (handlers[e] ??= []).push(h) } }

const session = createKeySession({
  address: ADDRESS,
  derive: fakeDerive,
  provider,
  clearOnPageHide: false, // no DOM in this script
})

// Concurrent callers share ONE derivation.
await Promise.all([session.getKey(), session.getKey()])
await session.getKey()
console.log(`after 3 getKey() calls: ${derivations} derivation(s)`) // → 1

// Account change wipes the key; the next getKey() re-derives.
for (const h of handlers['accountsChanged'] ?? []) h()
await session.getKey()
console.log(`after accountsChanged + getKey(): ${derivations} derivation(s)`) // → 2
```

- [ ] **Step 9: Write README, AGENTS, CHANGELOG, and copy LICENSE**

`packages/wallet-key-session/README.md`:

```markdown
# @valve-tech/wallet-key-session

Memory-only lifecycle for a **wallet-derived encryption key**. Derive
the key once per session, never persist it, and wipe it on
disconnect / account-change / tab-close.

`viem/siwe` owns SIWE; [`@valve-tech/wallet-crypto`](../wallet-crypto)
owns the key *derivation*. This package owns the one thing neither
does: the **stateful lifecycle** of the derived `CryptoKey` in a
browser tab.

## Install

```bash
npm install @valve-tech/wallet-key-session @valve-tech/wallet-crypto viem
```

## Use

```ts
import { createKeySession } from '@valve-tech/wallet-key-session'
import { deriveWalletEncryptionKey } from '@valve-tech/wallet-crypto'

const session = createKeySession({
  address,
  derive: () =>
    deriveWalletEncryptionKey({ signer: walletClient, purpose: 'notes-vault', version: 1 }),
  provider: window.ethereum, // auto-clear on accountsChanged / chainChanged
})

const key = await session.getKey() // first call prompts the wallet; later calls reuse it
// ...later, on sign-out:
session.clear()
```

## Invariants

- The `CryptoKey` lives **only** in a closure variable — never
  `localStorage` / `sessionStorage` / `IndexedDB` / cookies.
- `getKey()` memoizes the in-flight promise: `derive` runs once even
  under concurrent callers. A **rejected** derivation is not cached, so
  a declined wallet prompt can be retried.
- `clear()` and any `accountsChanged` / `chainChanged` / `pagehide`
  event drop the reference; the next `getKey()` re-derives (re-prompts).
- Browser-safe: no `node:*` imports; `window` access is guarded.

## Part of the toolkit

`@valve-tech/wallet-key-session` ships on the
[valve-tech/evm-toolkit](https://github.com/valve-tech/evm-toolkit)
synchronized release line. Pairs with `@valve-tech/wallet-crypto`
(derivation) and `viem/siwe` + `@valve-tech/siwe-store` (auth).
```

`packages/wallet-key-session/AGENTS.md`:

```markdown
# AGENTS.md

Terse reference for AI agents integrating
`@valve-tech/wallet-key-session`. Full README is for humans.

## What this package does

Owns the **memory-only lifecycle** of a wallet-derived encryption
`CryptoKey` in a browser tab. It does NOT derive the key (that's
`@valve-tech/wallet-crypto`) and does NOT do SIWE (that's `viem/siwe`
+ `@valve-tech/siwe-store`). One factory, no storage.

## Public API

```ts
import { createKeySession } from '@valve-tech/wallet-key-session'
import type { KeySession, Eip1193Like } from '@valve-tech/wallet-key-session'

const session: KeySession = createKeySession({
  address,                 // Address the key is bound to
  derive,                  // () => Promise<CryptoKey> — wire wallet-crypto here
  provider,                // optional Eip1193Like — auto-clear on account/chain change
  clearOnPageHide,         // optional, default true — clear on pagehide
})
// session.address      readonly Address
// session.getKey()     Promise<CryptoKey>  (derive-once, concurrent-safe, retry-on-reject)
// session.clear()      void                (drop the key; next getKey re-derives)
```

## Invariants (load-bearing)

1. **Memory-only.** The CryptoKey never leaves a closure variable. No
   persistent storage of any kind.
2. **Derive-once.** `getKey()` memoizes the promise; concurrent callers
   share one derivation. A rejected derivation is NOT cached.
3. **Wipe on identity/visibility change.** `accountsChanged`,
   `chainChanged`, `pagehide`, and `clear()` all drop the key.
4. **Injectable derivation.** `derive` is a callback, so the package
   has no `@valve-tech/wallet-crypto` dependency and is testable
   without a wallet.

## Composition

- **`@valve-tech/wallet-crypto`** — provides `deriveWalletEncryptionKey`;
  wire it into `derive`. The `WalletDeclined` / `WalletUnavailable`
  throws surface through `getKey()`'s rejected promise.
- **`viem/siwe` + `@valve-tech/siwe-store`** — the auth half; orthogonal
  to this package.

## Skills

`skills/wallet-key-session-integration/SKILL.md` ships in the tarball.
```

`packages/wallet-key-session/CHANGELOG.md`:

```markdown
# Changelog

All notable changes to `@valve-tech/wallet-key-session` are documented
here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to the valve-tech/evm-toolkit synchronized
release line.

## [Unreleased]

### Added

- Initial release. `createKeySession` owns the memory-only lifecycle
  of a wallet-derived encryption `CryptoKey`: derive-once (concurrent-
  safe, retry-on-reject), and auto-wipe on `accountsChanged` /
  `chainChanged` / `pagehide` / `clear()`. Browser-safe; the
  derivation is injected so the lifecycle is testable without a wallet.
  Pairs `@valve-tech/wallet-crypto`. Extracted from the stateful half
  of the removed `@valve-tech/auth-lite` design.
```

Then copy the license:

```bash
cp packages/wallet-crypto/LICENSE packages/wallet-key-session/LICENSE
```

- [ ] **Step 10: Write the integration skill**

`packages/wallet-key-session/skills/wallet-key-session-integration/SKILL.md`:

```markdown
---
name: wallet-key-session-integration
description: Integrate `@valve-tech/wallet-key-session` — the memory-only lifecycle of a wallet-derived encryption key — into viem-based dapps. Use when calling `createKeySession` to derive a `CryptoKey` once per session and wipe it on disconnect/account-change/tab-close, when wiring `@valve-tech/wallet-crypto`'s `deriveWalletEncryptionKey` into the `derive` callback, or when asked "how do I cache a wallet-derived key without persisting it", "how do I re-prompt the wallet when the account changes", or "why does my decryption key survive a wallet switch" (it shouldn't — that's what this package fixes). Also fires on questions about `KeySession`, the concurrent-safe derive-once memoization, or `clearOnPageHide`. Skip when the user only needs the derivation itself (no lifecycle) — that's `wallet-crypto-integration` — or when they need SIWE auth — that's `viem/siwe` + `siwe-store-integration`.
---

# Integrating `@valve-tech/wallet-key-session`

This package owns ONE thing: the in-memory lifecycle of a
wallet-derived encryption `CryptoKey` in a browser tab. It does not
derive the key and does not do SIWE.

## The wiring

```ts
import { createKeySession } from '@valve-tech/wallet-key-session'
import { deriveWalletEncryptionKey } from '@valve-tech/wallet-crypto'

const session = createKeySession({
  address,
  derive: () =>
    deriveWalletEncryptionKey({ signer: walletClient, purpose: 'myapp-feature', version: 1 }),
  provider: window.ethereum,
})

const key = await session.getKey() // prompts once; cached after
```

## When to recommend it

- The user is caching a `deriveWalletEncryptionKey` result in a React
  ref / module variable / state by hand → replace with `createKeySession`
  (it gets the concurrent-safe memoization and the auto-wipe right).
- The user reports the key "still works after switching wallets" → they
  have no `accountsChanged` teardown; pass `provider`.
- The user wants the key gone on tab close → `clearOnPageHide` (default
  `true`) already does it.

## Invariants to enforce in review

1. **Never persist the key.** If you see the CryptoKey written to
   storage, that defeats the whole package. The key is re-derivable
   from the wallet — re-prompt instead of persisting.
2. **Derive-once, retry-on-reject.** `getKey()` memoizes the promise;
   a declined prompt is not cached, so the next `getKey()` re-prompts.
   Don't wrap `getKey()` in your own retry/caching layer.
3. **The derivation is injected.** Don't add a hard dependency on
   `@valve-tech/wallet-crypto` inside this package's consumers'
   `derive` — pass the callback.

## Composition

- **`@valve-tech/wallet-crypto`** — the `derive` callback's body.
  `WalletDeclined` / `WalletUnavailable` surface through the rejected
  `getKey()` promise; handle them in the caller.
- **`viem/siwe` + `@valve-tech/siwe-store`** — the auth half. A typical
  app does SIWE first (sign-in), then derives the key lazily on first
  encrypt/decrypt — two distinct wallet prompts by design.

## Where to find more

- API + types: `node_modules/@valve-tech/wallet-key-session/AGENTS.md`
- Human docs: `node_modules/@valve-tech/wallet-key-session/README.md`
- Sibling skills: `wallet-crypto-integration`, `siwe-store-integration`,
  `building-apps-with-evm-toolkit`.
```

- [ ] **Step 11: Wire the package into release coverage + root example typecheck**

In `.github/workflows/release.yml`, add a publish step (place it right before the `Publish @valve-tech/wallet-crypto` step — no `@valve-tech` deps, so order is free):

```yaml
      - name: Publish @valve-tech/wallet-key-session
        run: |
          cd packages/wallet-key-session
          yarn pack --out=/tmp/wallet-key-session.tgz
          npm publish /tmp/wallet-key-session.tgz --access public --provenance
```

In the root `package.json`, append `wallet-key-session` to `typecheck:examples` (the `auth-lite` segment is removed in Task 5; leave it for now). The line becomes:

```json
    "typecheck:examples": "yarn workspace @valve-tech/gas-oracle run typecheck:examples && yarn workspace @valve-tech/wallet-adapter run typecheck:examples && yarn workspace @valve-tech/wallet-crypto run typecheck:examples && yarn workspace @valve-tech/auth-lite run typecheck:examples && yarn workspace @valve-tech/wallet-key-session run typecheck:examples",
```

- [ ] **Step 12: Verify build, lint, typecheck, example typecheck, and run the example**

Run from repo root:
```bash
yarn workspace @valve-tech/wallet-key-session build
yarn workspace @valve-tech/wallet-key-session lint
yarn workspace @valve-tech/wallet-key-session typecheck
yarn workspace @valve-tech/wallet-key-session typecheck:examples
yarn dlx tsx packages/wallet-key-session/examples/01-key-session-lifecycle.ts
```
Expected: all silent/PASS; the example prints `1 derivation(s)` then `2 derivation(s)`.

- [ ] **Step 13: Commit**

```bash
git add packages/wallet-key-session .github/workflows/release.yml package.json
git commit -m "feat(wallet-key-session): memory-only wallet-derived key lifecycle"
```

---

### Task 2: Create `@valve-tech/siwe-store` (server, nonce single-use/TTL + opaque session)

**Files:**
- Create: `packages/siwe-store/package.json`
- Create: `packages/siwe-store/tsconfig.json`
- Create: `packages/siwe-store/src/nonce-store.ts`
- Create: `packages/siwe-store/src/session-store.ts`
- Create: `packages/siwe-store/src/index.ts`
- Test:   `packages/siwe-store/src/nonce-store.test.ts`
- Test:   `packages/siwe-store/src/session-store.test.ts`
- Create: `packages/siwe-store/examples/01-nonce-and-session.ts`
- Create: `packages/siwe-store/examples/tsconfig.json`
- Create: `packages/siwe-store/skills/siwe-store-integration/SKILL.md`
- Create: `packages/siwe-store/README.md`
- Create: `packages/siwe-store/AGENTS.md`
- Create: `packages/siwe-store/CHANGELOG.md`
- Create: `packages/siwe-store/LICENSE` (copied from `packages/wallet-crypto/LICENSE`)
- Modify: `.github/workflows/release.yml` (add Publish step)
- Modify: `package.json` (root — add to `typecheck:examples`)

**Interfaces:**
- Consumes: `viem/siwe`'s `generateSiweNonce`; `node:crypto`'s `randomBytes`; `viem`'s `Address` type.
- Produces (Task 3 relies on these exact names/types):
  - `createMemoryNonceStore(opts?: { ttlSeconds?: number }): NonceStore`
  - `interface NonceStore { issue(): string; consume(nonce: string): boolean }`
  - `createMemorySessionStore(opts?: { ttlMs?: number }): SessionStore`
  - `interface Session { address: Address; issuedAt: number; claims?: Record<string, unknown> }`
  - `interface SessionStore { issue(address: Address, claims?: Record<string, unknown>): string; validate(token: string): Session | null; revoke(token: string): void }`

- [ ] **Step 1: Create the package manifest**

`packages/siwe-store/package.json`:

```json
{
  "name": "@valve-tech/siwe-store",
  "version": "0.18.0",
  "description": "Server-side state for SIWE (Sign-In with Ethereum) that viem/siwe deliberately leaves to the app: a single-use, TTL'd nonce store (atomic consume, delete-before-TTL-check so a race-loser cannot reuse) and an opaque CSPRNG session store bound to an address. Ships interfaces (the contract for Redis/SQL implementations) plus in-memory defaults; pairs viem/siwe for the crypto/message/validation half. Part of the valve-tech/evm-toolkit synchronized release line.",
  "license": "MIT",
  "homepage": "https://github.com/valve-tech/evm-toolkit/tree/main/packages/siwe-store#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/valve-tech/evm-toolkit.git",
    "directory": "packages/siwe-store"
  },
  "bugs": {
    "url": "https://github.com/valve-tech/evm-toolkit/issues"
  },
  "keywords": [
    "ethereum",
    "evm",
    "viem",
    "siwe",
    "eip-4361",
    "nonce",
    "session",
    "replay-protection",
    "authentication",
    "server"
  ],
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "skills",
    "README.md",
    "AGENTS.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc -p .",
    "typecheck": "tsc -p . --noEmit",
    "typecheck:examples": "tsc -p examples",
    "lint": "eslint src",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "prepare": "yarn build"
  },
  "peerDependencies": {
    "viem": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create the tsconfig** (server — base `ES2020` lib + `node` types are enough; no `DOM`)

`packages/siwe-store/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Write the failing nonce-store test**

`packages/siwe-store/src/nonce-store.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMemoryNonceStore } from './nonce-store.js'

afterEach(() => vi.useRealTimers())

describe('createMemoryNonceStore', () => {
  it('issues a SIWE-valid nonce that consume() accepts exactly once', () => {
    const store = createMemoryNonceStore()
    const nonce = store.issue()
    expect(nonce).toMatch(/^[a-zA-Z0-9]{8,}$/) // generateSiweNonce shape
    expect(store.consume(nonce)).toBe(true)
    expect(store.consume(nonce)).toBe(false) // single-use: no replay
  })

  it('rejects an unknown nonce', () => {
    const store = createMemoryNonceStore()
    expect(store.consume('never-issued')).toBe(false)
  })

  it('rejects an expired nonce and removes it (delete-before-TTL ordering)', () => {
    vi.useFakeTimers()
    const store = createMemoryNonceStore({ ttlSeconds: 60 })
    const nonce = store.issue()
    vi.advanceTimersByTime(61_000)
    expect(store.consume(nonce)).toBe(false) // expired
    expect(store.consume(nonce)).toBe(false) // and already removed
  })
})
```

- [ ] **Step 4: Write the failing session-store test**

`packages/siwe-store/src/session-store.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMemorySessionStore } from './session-store.js'

const ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const

afterEach(() => vi.useRealTimers())

describe('createMemorySessionStore', () => {
  it('issues an opaque token that validates back to the bound session', () => {
    const store = createMemorySessionStore()
    const token = store.issue(ADDR)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(32)
    const session = store.validate(token)
    expect(session?.address).toBe(ADDR)
    expect(typeof session?.issuedAt).toBe('number')
  })

  it('roundtrips claims', () => {
    const store = createMemorySessionStore()
    const token = store.issue(ADDR, { role: 'admin' })
    expect(store.validate(token)?.claims).toEqual({ role: 'admin' })
  })

  it('returns null for an unknown token', () => {
    const store = createMemorySessionStore()
    expect(store.validate('garbage')).toBeNull()
  })

  it('returns null after the token expires', () => {
    vi.useFakeTimers()
    const store = createMemorySessionStore({ ttlMs: 1000 })
    const token = store.issue(ADDR)
    vi.advanceTimersByTime(1001)
    expect(store.validate(token)).toBeNull()
  })

  it('returns null after revoke', () => {
    const store = createMemorySessionStore()
    const token = store.issue(ADDR)
    store.revoke(token)
    expect(store.validate(token)).toBeNull()
  })

  it('issues distinct tokens per call', () => {
    const store = createMemorySessionStore()
    expect(store.issue(ADDR)).not.toBe(store.issue(ADDR))
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `yarn workspace @valve-tech/siwe-store test`
Expected: FAIL — `Cannot find module './nonce-store.js'` / `'./session-store.js'`.

- [ ] **Step 6: Write the nonce-store implementation**

`packages/siwe-store/src/nonce-store.ts`:

```ts
/**
 * @fileoverview Single-use, TTL'd SIWE nonce store.
 *
 * The replay defense for SIWE: a nonce is valid for exactly one
 * `consume()`. `consume()` deletes BEFORE the TTL check so a race-loser
 * cannot reuse a nonce that a concurrent caller already claimed.
 *
 * The `NonceStore` interface is the contract for Redis/SQL backends;
 * `createMemoryNonceStore` is the single-instance in-memory default
 * (resets on restart — see the README for the production path).
 */

import { generateSiweNonce } from 'viem/siwe'

/** Issue + single-use-consume a SIWE nonce. */
export interface NonceStore {
  /** Issue a fresh SIWE-valid nonce (`generateSiweNonce`) and remember it. */
  issue(): string
  /**
   * True iff the nonce was issued, unexpired, and unconsumed. Deletes on
   * lookup (atomic single-use, delete-before-TTL-check).
   */
  consume(nonce: string): boolean
}

/** Default nonce TTL: 5 minutes. */
const DEFAULT_TTL_SECONDS = 5 * 60

/** Create an in-memory single-use nonce store. */
export function createMemoryNonceStore(opts?: { ttlSeconds?: number }): NonceStore {
  const ttlMs = (opts?.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000
  const issued = new Map<string, number>() // nonce -> expiresAt (ms epoch)

  return {
    issue() {
      const nonce = generateSiweNonce()
      issued.set(nonce, Date.now() + ttlMs)
      return nonce
    },
    consume(nonce) {
      const expiresAt = issued.get(nonce)
      if (expiresAt === undefined) return false
      // Delete BEFORE the time check: a concurrent second consume of the
      // same nonce finds nothing, so a race-loser cannot reuse it.
      issued.delete(nonce)
      return expiresAt >= Date.now()
    },
  }
}
```

- [ ] **Step 7: Write the session-store implementation**

`packages/siwe-store/src/session-store.ts`:

```ts
/**
 * @fileoverview Opaque, address-bound session store.
 *
 * Issues a CSPRNG token (`randomBytes` base64url) bound to an address
 * (plus optional claims), with a TTL. The token is opaque — it carries
 * no signed state; the binding lives server-side. The `SessionStore`
 * interface is the contract for Redis/SQL backends;
 * `createMemorySessionStore` is the single-instance in-memory default.
 */

import { randomBytes } from 'node:crypto'
import type { Address } from 'viem'

/** A server-side session bound to an address. */
export interface Session {
  address: Address
  /** ms-epoch issuance time. */
  issuedAt: number
  /** Optional app-defined claims carried with the session. */
  claims?: Record<string, unknown>
}

/** Issue / validate / revoke opaque sessions. */
export interface SessionStore {
  /** Issue an opaque CSPRNG token bound to the address. */
  issue(address: Address, claims?: Record<string, unknown>): string
  /** The bound session if the token is valid + unexpired, else null. */
  validate(token: string): Session | null
  /** Invalidate a token (sign-out). */
  revoke(token: string): void
}

/** Default session TTL: 30 minutes. */
const DEFAULT_TTL_MS = 30 * 60 * 1000

/** Create an in-memory opaque session store. */
export function createMemorySessionStore(opts?: { ttlMs?: number }): SessionStore {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS
  const sessions = new Map<string, { session: Session; expiresAt: number }>()

  return {
    issue(address, claims) {
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, {
        session: { address, issuedAt: Date.now(), claims },
        expiresAt: Date.now() + ttlMs,
      })
      return token
    },
    validate(token) {
      const stored = sessions.get(token)
      if (!stored) return null
      if (stored.expiresAt < Date.now()) {
        sessions.delete(token)
        return null
      }
      return stored.session
    },
    revoke(token) {
      sessions.delete(token)
    },
  }
}
```

- [ ] **Step 8: Write the public entry point**

`packages/siwe-store/src/index.ts`:

```ts
/**
 * @fileoverview Public API of `@valve-tech/siwe-store`.
 *
 * Server-side SIWE state — the single-use nonce store and the opaque
 * session store — that `viem/siwe` deliberately leaves to the app.
 * Pairs `viem/siwe` (crypto + message + validation).
 */

export { createMemoryNonceStore } from './nonce-store.js'
export type { NonceStore } from './nonce-store.js'
export { createMemorySessionStore } from './session-store.js'
export type { Session, SessionStore } from './session-store.js'
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `yarn workspace @valve-tech/siwe-store test`
Expected: PASS — all nonce + session tests green.

- [ ] **Step 10: Create the example + its tsconfig**

`packages/siwe-store/examples/tsconfig.json` (identical to Task 1 Step 8's):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": false
  },
  "include": ["**/*.ts"]
}
```

`packages/siwe-store/examples/01-nonce-and-session.ts`:

```ts
/**
 * 01 — The server-side SIWE state stores.
 *
 * The nonce store is the replay defense (single-use); the session
 * store is the "still logged in" state (opaque token → address).
 * `viem/siwe` does the crypto/message/validation in between — see the
 * encrypted-vault example for the full GET /auth/challenge →
 * POST /auth/verify wiring.
 *
 * Run with: yarn tsx packages/siwe-store/examples/01-nonce-and-session.ts
 */

import { createMemoryNonceStore, createMemorySessionStore } from '../src/index.js'

const nonces = createMemoryNonceStore()
const sessions = createMemorySessionStore()

const nonce = nonces.issue()
console.log('issued nonce:', nonce)
console.log('first consume :', nonces.consume(nonce)) // true
console.log('replay consume:', nonces.consume(nonce)) // false — single-use

const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const
const token = sessions.issue(address, { plan: 'demo' })
console.log('session:', sessions.validate(token)) // { address, issuedAt, claims: { plan: 'demo' } }
sessions.revoke(token)
console.log('after revoke:', sessions.validate(token)) // null
```

- [ ] **Step 11: Write README, AGENTS, CHANGELOG, and copy LICENSE**

`packages/siwe-store/README.md`:

```markdown
# @valve-tech/siwe-store

The server-side **state** for Sign-In with Ethereum that
[`viem/siwe`](https://viem.sh/docs/siwe) deliberately leaves to the
app: a **single-use, TTL'd nonce store** (the replay defense) and an
**opaque session store** (the "still logged in" state).

`viem/siwe` owns the crypto, the EIP-4361 message, and validation.
This package owns the two stateful pieces it can't: atomic nonce
consumption and session issuance.

## Install

```bash
npm install @valve-tech/siwe-store viem
```

## Use

```ts
import { createMemoryNonceStore, createMemorySessionStore } from '@valve-tech/siwe-store'
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import { recoverMessageAddress, isAddressEqual } from 'viem'

const nonces = createMemoryNonceStore()
const sessions = createMemorySessionStore()

// GET /auth/challenge
const message = createSiweMessage({
  address, chainId, domain, uri, version: '1', nonce: nonces.issue(), statement,
})

// POST /auth/verify  { message, signature }
const fields = parseSiweMessage(message)
if (!fields.nonce || !nonces.consume(fields.nonce)) throw new Error('replay')
if (!validateSiweMessage({ message, domain })) throw new Error('bad domain/time')
const recovered = await recoverMessageAddress({ message, signature })
if (!fields.address || !isAddressEqual(recovered, fields.address)) throw new Error('bad sig')
const token = sessions.issue(fields.address)
```

## Interfaces vs. adapters

This package ships the `NonceStore` / `SessionStore` **interfaces**
(the contract for Redis/SQL/cookie backends) plus **in-memory
defaults**. The in-memory stores are single-instance and reset on
restart — for multi-instance production state, implement the
interfaces over Redis, or reach for [iron-session] / [NextAuth]. This
package intentionally ships no such adapter.

[iron-session]: https://github.com/vvo/iron-session
[NextAuth]: https://authjs.dev

## Part of the toolkit

`@valve-tech/siwe-store` ships on the
[valve-tech/evm-toolkit](https://github.com/valve-tech/evm-toolkit)
synchronized release line. Pairs with `viem/siwe` (crypto/message/
validation) and, on the client, `@valve-tech/wallet-key-session`.
```

`packages/siwe-store/AGENTS.md`:

```markdown
# AGENTS.md

Terse reference for AI agents integrating `@valve-tech/siwe-store`.

## What this package does

Owns SIWE **server state**: the single-use/TTL nonce store and the
opaque session store. It does NOT do SIWE crypto/message/validation —
that's `viem/siwe`. Ships interfaces + in-memory defaults only.

## Public API

```ts
import {
  createMemoryNonceStore,    // (opts?: { ttlSeconds?: number }) => NonceStore
  createMemorySessionStore,  // (opts?: { ttlMs?: number }) => SessionStore
} from '@valve-tech/siwe-store'
import type { NonceStore, SessionStore, Session } from '@valve-tech/siwe-store'

// NonceStore:   issue(): string ; consume(nonce): boolean   (single-use, delete-before-TTL)
// SessionStore: issue(address, claims?): string ; validate(token): Session | null ; revoke(token): void
// Session:      { address: Address; issuedAt: number; claims?: Record<string, unknown> }
```

## Invariants (load-bearing)

1. **Single-use nonce.** `consume()` returns true at most once per
   nonce; it deletes BEFORE the TTL check so a race-loser cannot reuse.
2. **Opaque session token.** A CSPRNG `randomBytes(32)` base64url
   string. It carries no signed state; the binding is server-side.
3. **Interfaces are the contract.** Redis/SQL backends implement
   `NonceStore` / `SessionStore`; only the in-memory adapters ship.
   In-memory stores reset on restart — not for multi-instance prod.

## The verify recipe (with viem/siwe)

```
parseSiweMessage(message) → fields
nonceStore.consume(fields.nonce)            // single-use / replay
validateSiweMessage({ message, domain })    // domain binding + time validity
recoverMessageAddress({ message, signature }) === fields.address  // crypto
sessionStore.issue(fields.address)          // on success
// any failure → uniform 401
```

Do NOT pass `nonce` to `validateSiweMessage` — issuance/single-use is
the store's job, not a string-equality re-check.

## Skills

`skills/siwe-store-integration/SKILL.md` ships in the tarball.
```

`packages/siwe-store/CHANGELOG.md`:

```markdown
# Changelog

All notable changes to `@valve-tech/siwe-store` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to the valve-tech/evm-toolkit synchronized
release line.

## [Unreleased]

### Added

- Initial release. `createMemoryNonceStore` (single-use, TTL'd, atomic
  delete-before-TTL-check) and `createMemorySessionStore` (opaque
  CSPRNG token bound to an address, with TTL + revoke). Ships the
  `NonceStore` / `SessionStore` interfaces as the contract for
  Redis/SQL backends. Pairs `viem/siwe`. Replaces the stateful nonce/
  session layer that the removed `@valve-tech/auth-lite` left to the
  caller.
```

Then copy the license:

```bash
cp packages/wallet-crypto/LICENSE packages/siwe-store/LICENSE
```

- [ ] **Step 12: Write the integration skill**

`packages/siwe-store/skills/siwe-store-integration/SKILL.md`:

```markdown
---
name: siwe-store-integration
description: Integrate `@valve-tech/siwe-store` — the server-side state for Sign-In with Ethereum (SIWE / EIP-4361) — alongside `viem/siwe`. Use when calling `createMemoryNonceStore` for single-use/TTL replay protection or `createMemorySessionStore` for opaque address-bound sessions, when wiring the `GET /auth/challenge` → `POST /auth/verify` flow with `createSiweMessage` / `parseSiweMessage` / `validateSiweMessage` / `recoverMessageAddress`, or when asked "how do I stop SIWE nonce replay", "where do I store the SIWE session", "viem/siwe doesn't persist the nonce — what do I use", or "how do I make this work across multiple server instances" (implement the interfaces over Redis). Skip when the user only needs the SIWE message/crypto — that's `viem/siwe` directly — or when they need the browser key lifecycle — that's `wallet-key-session-integration`.
---

# Integrating `@valve-tech/siwe-store`

`viem/siwe` owns the SIWE crypto, message, and validation. This package
owns the two stateful pieces it leaves to you: the single-use nonce
store and the opaque session store. Always pair the two.

## The full server flow

```ts
import { createMemoryNonceStore, createMemorySessionStore } from '@valve-tech/siwe-store'
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import { recoverMessageAddress, isAddressEqual, getAddress } from 'viem'

const nonces = createMemoryNonceStore()
const sessions = createMemorySessionStore()

// GET /auth/challenge?address=&chainId=  — domain/uri/chainId/statement from SERVER config
function challenge(address: string) {
  return createSiweMessage({
    address: getAddress(address),
    chainId: CHAIN_ID, domain: DOMAIN, uri: URI, version: '1',
    nonce: nonces.issue(), statement: STATEMENT,
    issuedAt: new Date(), expirationTime: new Date(Date.now() + 5 * 60_000),
  })
}

// POST /auth/verify  { message, signature }
async function verify(message: string, signature: `0x${string}`) {
  const fields = parseSiweMessage(message)
  if (!fields.nonce || !nonces.consume(fields.nonce)) return null   // single-use / replay
  if (!validateSiweMessage({ message, domain: DOMAIN })) return null // domain + time
  const recovered = await recoverMessageAddress({ message, signature })
  if (!fields.address || !isAddressEqual(recovered, fields.address)) return null
  return sessions.issue(fields.address)                              // opaque token
}
```

## Invariants to enforce in review

1. **Binding fields come from server config, never the request body.**
   `domain`, `uri`, `chainId`, `statement` are trusted server values.
   Taking `domain` from the request lets an attacker rebind a signature.
2. **`consume()` is the replay check — call it once.** Don't also pass
   `nonce` to `validateSiweMessage`; that's a circular string-equality
   re-check. Issuance + single-use is the store's job.
3. **Uniform failure.** Every verify failure path returns the same
   `401` — don't leak which check failed.
4. **In-memory = single instance.** For multi-instance deploys,
   implement `NonceStore` / `SessionStore` over Redis (or use
   iron-session / NextAuth). Flag any in-memory store behind a load
   balancer.

## Composition

- **`viem/siwe`** — the crypto/message/validation half. Mandatory pair.
- **`@valve-tech/wallet-key-session`** — the *client* key lifecycle, if
  the app also encrypts data to the wallet. Orthogonal to this package.
- **`building-apps-with-evm-toolkit`** — the seam-level recipe that
  wires login + wallet-encrypted data end to end.

## Where to find more

- API + types: `node_modules/@valve-tech/siwe-store/AGENTS.md`
- Human docs: `node_modules/@valve-tech/siwe-store/README.md`
- Runnable example of the full flow: the `encrypted-vault` example in
  the evm-toolkit repo.
```

- [ ] **Step 13: Wire the package into release coverage + root example typecheck**

In `.github/workflows/release.yml`, add a publish step (place it right after the new `Publish @valve-tech/wallet-key-session` step):

```yaml
      - name: Publish @valve-tech/siwe-store
        run: |
          cd packages/siwe-store
          yarn pack --out=/tmp/siwe-store.tgz
          npm publish /tmp/siwe-store.tgz --access public --provenance
```

In the root `package.json`, append `siwe-store` to `typecheck:examples` (after the `wallet-key-session` segment added in Task 1):

```json
    "typecheck:examples": "yarn workspace @valve-tech/gas-oracle run typecheck:examples && yarn workspace @valve-tech/wallet-adapter run typecheck:examples && yarn workspace @valve-tech/wallet-crypto run typecheck:examples && yarn workspace @valve-tech/auth-lite run typecheck:examples && yarn workspace @valve-tech/wallet-key-session run typecheck:examples && yarn workspace @valve-tech/siwe-store run typecheck:examples",
```

- [ ] **Step 14: Verify build, lint, typecheck, example typecheck, and run the example**

```bash
yarn workspace @valve-tech/siwe-store build
yarn workspace @valve-tech/siwe-store lint
yarn workspace @valve-tech/siwe-store typecheck
yarn workspace @valve-tech/siwe-store typecheck:examples
yarn dlx tsx packages/siwe-store/examples/01-nonce-and-session.ts
```
Expected: all silent/PASS; the example prints `first consume : true`, `replay consume: false`, the session object, then `after revoke: null`.

- [ ] **Step 15: Commit**

```bash
git add packages/siwe-store .github/workflows/release.yml package.json
git commit -m "feat(siwe-store): single-use nonce + opaque session stores for viem/siwe"
```

---

### Task 3: Rework the `encrypted-vault` server to full EIP-4361 + `siwe-store`

**Files:**
- Delete: `examples/encrypted-vault/server/nonce-store.ts`
- Delete: `examples/encrypted-vault/server/nonce-store.test.ts`
- Delete: `examples/encrypted-vault/server/session-store.ts`
- Delete: `examples/encrypted-vault/server/session-store.test.ts`
- Modify: `examples/encrypted-vault/server/config.ts`
- Modify: `examples/encrypted-vault/server/server.ts`
- Modify: `examples/encrypted-vault/package.json` (dependencies)
- Keep unchanged: `server/http.ts`, `server/note-store.ts`, `server/note-store.test.ts`

**Interfaces:**
- Consumes: `@valve-tech/siwe-store`'s `createMemoryNonceStore`, `createMemorySessionStore`; `viem/siwe`'s `createSiweMessage`, `parseSiweMessage`, `validateSiweMessage`; `viem`'s `recoverMessageAddress`, `isAddressEqual`, `getAddress`.
- Produces (the wire contract Task 4's client must match exactly):
  - `GET /auth/challenge?address=<0x…>&chainId=<number>` → `200 { message: string }` (or `400` on a malformed `address`).
  - `POST /auth/verify` body `{ message: string, signature: 0x… }` → `200 { token: string, address: Address }` or `401`.
  - `GET /notes` (Bearer) → `200 { notes: StoredBlob[] }` or `401`.
  - `POST /notes` (Bearer) body `{ blob: StoredBlob }` → `200 { ok: true }` or `401`.

- [ ] **Step 1: Delete the example's own store source + tests (promoted into `siwe-store`)**

```bash
git rm examples/encrypted-vault/server/nonce-store.ts \
       examples/encrypted-vault/server/nonce-store.test.ts \
       examples/encrypted-vault/server/session-store.ts \
       examples/encrypted-vault/server/session-store.test.ts
```

- [ ] **Step 2: Swap the example's dependency**

In `examples/encrypted-vault/package.json`, replace the `@valve-tech/auth-lite` dependency line with the two new packages (keep `@valve-tech/viem-errors`, `@valve-tech/wallet-crypto`, `react`, `react-dom`, `viem`). The `dependencies` block becomes:

```json
  "dependencies": {
    "@valve-tech/siwe-store": "^0.18.0",
    "@valve-tech/viem-errors": "^0.18.0",
    "@valve-tech/wallet-crypto": "^0.18.0",
    "@valve-tech/wallet-key-session": "^0.18.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "viem": "^2.21.0"
  },
```

Also update the example's `description` field (it names auth-lite) to:

```json
  "description": "Wallet-login encrypted notes vault: sign in with your wallet (full EIP-4361 SIWE via viem/siwe + @valve-tech/siwe-store), write private notes encrypted to your wallet (@valve-tech/wallet-crypto + @valve-tech/wallet-key-session), read them back decrypted. The server persists ciphertext only and is cryptographically blind to your notes.",
```

- [ ] **Step 3: Rewrite the server config to carry the SIWE binding fields**

Replace `examples/encrypted-vault/server/config.ts` with:

```ts
/**
 * Server-side configuration. The SIWE binding fields (DOMAIN, URI,
 * CHAIN_ID, STATEMENT) MUST come from trusted server context — never
 * from a request body. An attacker who could set `domain` could rebind
 * a signature to a different origin.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** EIP-4361 `domain` — the origin the user is signing in to. */
export const DOMAIN = process.env.SIWE_DOMAIN ?? 'localhost:8790'

/** EIP-4361 `uri` — the full URI the user is signing in to. */
export const URI = process.env.SIWE_URI ?? 'http://localhost:8790'

/** EIP-4361 `chainId`. The server is authoritative for this value. */
export const CHAIN_ID = Number(process.env.SIWE_CHAIN_ID ?? 1)

/** EIP-4361 `statement` — the human-readable line shown in the wallet. */
export const STATEMENT =
  process.env.SIWE_STATEMENT ??
  'Sign in to the Encrypted Vault. This signature authenticates your session and does NOT authorize any transaction.'

export const PORT = Number(process.env.PORT ?? 8790)

/** Opaque session token lifetime. */
export const SESSION_TTL_MS = 30 * 60 * 1000

/** SIWE nonce lifetime (seconds). Doubles as the message expiry window. */
export const NONCE_TTL_SECONDS = 5 * 60

/** JSON ciphertext store path. README: "a real app uses a database." */
export const STORE_PATH = process.env.STORE_PATH ?? join(__dirname, '..', 'notes-store.json')

/** Built client root, served in production. */
export const CLIENT_DIST = join(__dirname, '..', '..', 'dist')
```

- [ ] **Step 4: Rewrite the server to do the full SIWE flow**

Replace `examples/encrypted-vault/server/server.ts` with:

```ts
/**
 * Minimal plain-Node HTTP server for the encrypted-vault example.
 *
 * Endpoints:
 *   GET  /auth/challenge?address=&chainId=  → { message }   (issue nonce + build SIWE message)
 *   POST /auth/verify                       → { token, address }  (consume nonce + validate + recover)
 *   GET  /notes      (Bearer)               → { notes: StoredBlob[] }
 *   POST /notes      (Bearer)               → { ok: true }   (store ciphertext only)
 *
 * The store holds ciphertext only — the server cannot read a note. All
 * SIWE binding fields come from server config, never the request body.
 * In production this also serves dist/.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { createMemoryNonceStore, createMemorySessionStore } from '@valve-tech/siwe-store'
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import { recoverMessageAddress, isAddressEqual, getAddress, type Hex } from 'viem'
import { DOMAIN, URI, CHAIN_ID, STATEMENT, PORT, NONCE_TTL_SECONDS, SESSION_TTL_MS, STORE_PATH, CLIENT_DIST } from './config.js'
import { createNoteStore, type StoredBlob } from './note-store.js'
import { readJsonBody, bearerToken, sendJson, send401 } from './http.js'

const nonces = createMemoryNonceStore({ ttlSeconds: NONCE_TTL_SECONDS })
const sessions = createMemorySessionStore({ ttlMs: SESSION_TTL_MS })
const notes = createNoteStore(STORE_PATH)

interface VerifyBody { message: string; signature: Hex }
interface NoteBody { blob: StoredBlob }

const contentType = (path: string): string => {
  if (path.endsWith('.html')) return 'text/html'
  if (path.endsWith('.js')) return 'text/javascript'
  if (path.endsWith('.css')) return 'text/css'
  return 'application/octet-stream'
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const method = req.method ?? 'GET'

  void (async (): Promise<void> => {
    try {
      // --- Auth: issue a nonce and build the EIP-4361 message ---
      if (method === 'GET' && url.pathname === '/auth/challenge') {
        const rawAddress = url.searchParams.get('address')
        if (!rawAddress) {
          sendJson(res, 400, { error: 'address query param required' })
          return
        }
        let address: `0x${string}`
        try {
          address = getAddress(rawAddress) // validate + checksum
        } catch {
          sendJson(res, 400, { error: 'malformed address' })
          return
        }
        // CHAIN_ID / DOMAIN / URI / STATEMENT come from server config,
        // NOT the request. The client's ?chainId= is advisory only.
        const message = createSiweMessage({
          address,
          chainId: CHAIN_ID,
          domain: DOMAIN,
          uri: URI,
          version: '1',
          nonce: nonces.issue(),
          statement: STATEMENT,
          issuedAt: new Date(),
          expirationTime: new Date(Date.now() + NONCE_TTL_SECONDS * 1000),
        })
        sendJson(res, 200, { message })
        return
      }

      // --- Auth: verify the signed message, issue an opaque session ---
      if (method === 'POST' && url.pathname === '/auth/verify') {
        const body = await readJsonBody<VerifyBody>(req)
        const fields = parseSiweMessage(body.message)

        // 1) single-use / replay defense — the nonce store IS the check.
        if (!fields.nonce || !nonces.consume(fields.nonce)) {
          send401(res, 'bad, expired, or replayed nonce')
          return
        }
        // 2) domain binding + time validity (expirationTime/notBefore).
        if (!validateSiweMessage({ message: body.message, domain: DOMAIN })) {
          send401(res, 'invalid SIWE message')
          return
        }
        // 3) crypto: recovered signer must equal the message's address.
        let recovered: `0x${string}`
        try {
          recovered = await recoverMessageAddress({ message: body.message, signature: body.signature })
        } catch {
          send401(res, 'invalid signature')
          return
        }
        if (!fields.address || !isAddressEqual(recovered, fields.address)) {
          send401(res, 'invalid signature')
          return
        }
        const token = sessions.issue(fields.address)
        sendJson(res, 200, { token, address: fields.address })
        return
      }

      // --- Notes: Bearer-gated, address-scoped ---
      if (url.pathname === '/notes' && (method === 'GET' || method === 'POST')) {
        const token = bearerToken(req)
        const session = token ? sessions.validate(token) : null
        if (!session) {
          send401(res, 'missing or expired session')
          return
        }
        if (method === 'GET') {
          sendJson(res, 200, { notes: notes.listNotes(session.address) })
          return
        }
        const body = await readJsonBody<NoteBody>(req)
        notes.addNote(session.address, body.blob)
        sendJson(res, 200, { ok: true })
        return
      }

      // --- Static client (production) ---
      const rel = url.pathname === '/' ? '/index.html' : url.pathname
      const filePath = normalize(join(CLIENT_DIST, rel))
      if (filePath !== CLIENT_DIST && !filePath.startsWith(CLIENT_DIST + sep)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      try {
        const file = await readFile(filePath)
        res.writeHead(200, { 'content-type': contentType(filePath) })
        res.end(file)
      } catch {
        res.writeHead(404)
        res.end('not found')
      }
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
  })()
})

server.listen(PORT, () => {
  console.log(`encrypted-vault server listening on :${PORT}  (domain "${DOMAIN}")`)
})
```

- [ ] **Step 5: Typecheck the server half**

Run: `yarn workspace @valve-tech/example-encrypted-vault exec tsc -p tsconfig.server.json --noEmit`
Expected: PASS (no type errors). The client half still references `auth-lite`; that's fixed in Task 4.

- [ ] **Step 6: Commit**

```bash
git add examples/encrypted-vault/server examples/encrypted-vault/package.json
git commit -m "feat(examples): encrypted-vault — server uses viem/siwe + siwe-store (full EIP-4361)"
```

---

### Task 4: Rework the `encrypted-vault` client to `viem/siwe` + `wallet-key-session`

**Files:**
- Modify: `examples/encrypted-vault/src/lib/api.ts`
- Modify: `examples/encrypted-vault/src/lib/session.ts`
- Modify: `examples/encrypted-vault/src/lib/wallet.ts`
- Modify: `examples/encrypted-vault/src/lib/blob.ts` (comment only)
- Modify: `examples/encrypted-vault/src/App.tsx`
- Modify: `examples/encrypted-vault/index.html` (meta description)
- Modify: `examples/encrypted-vault/README.md`
- Keep unchanged: `src/components/*`, `src/main.tsx`, `src/styles.css`, `src/lib/blob.ts` (code)

**Interfaces:**
- Consumes: the Task 3 wire contract (`GET /auth/challenge?address=&chainId=` → `{ message }`; `POST /auth/verify { message, signature }` → `{ token, address }`); `@valve-tech/wallet-key-session`'s `createKeySession`; `@valve-tech/wallet-crypto`'s `deriveWalletEncryptionKey` + `WalletUnavailable` + `WalletDeclined`.
- Produces: nothing downstream (leaf example).

- [ ] **Step 1: Rewrite the API client for the challenge/verify shape**

Replace `examples/encrypted-vault/src/lib/api.ts` with:

```ts
/**
 * Typed fetch wrappers for the vault API. Same-origin in prod (the
 * Node server serves the client); proxied to the server in dev.
 */
import type { Address, Hex } from 'viem'
import type { WireBlob } from './blob.js'

export class AuthError extends Error {}

/** GET the server-built EIP-4361 SIWE message to sign. */
export async function fetchChallenge(address: Address, chainId: number): Promise<string> {
  const res = await fetch(`/auth/challenge?address=${address}&chainId=${chainId}`)
  if (!res.ok) throw new AuthError('could not get a sign-in challenge')
  return ((await res.json()) as { message: string }).message
}

/** POST the signed message + signature; get back an opaque session token. */
export async function verifySignature(input: {
  message: string
  signature: Hex
}): Promise<{ token: string; address: Address }> {
  const res = await fetch('/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({ error: 'auth failed' }))) as { error: string }
    throw new AuthError(error)
  }
  return (await res.json()) as { token: string; address: Address }
}

export async function fetchNotes(token: string): Promise<WireBlob[]> {
  const res = await fetch('/notes', { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new AuthError('session expired — sign in again')
  return ((await res.json()) as { notes: WireBlob[] }).notes
}

export async function postNote(token: string, blob: WireBlob): Promise<void> {
  const res = await fetch('/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ blob }),
  })
  if (!res.ok) throw new AuthError('session expired — sign in again')
}
```

- [ ] **Step 2: Rewrite the client session module to dogfood `createKeySession`**

Replace `examples/encrypted-vault/src/lib/session.ts` with:

```ts
/**
 * Client session + wallet-derived key lifecycle.
 *
 * Two signatures total: (1) the SIWE sign-in (viem/siwe message), and
 * (2) the key-derivation sign (wallet-crypto), derived LAZILY on first
 * encrypt/decrypt with purpose "notes-vault" version 1. The key
 * lifecycle (derive-once, wipe on account-change / tab-close) is
 * @valve-tech/wallet-key-session's audited memory-only one.
 */
import { createKeySession, type Eip1193Like } from '@valve-tech/wallet-key-session'
import { deriveWalletEncryptionKey } from '@valve-tech/wallet-crypto'
import type { Address, WalletClient } from 'viem'

export const KEY_PURPOSE = 'notes-vault'
export const KEY_VERSION = 1

export interface Session {
  token: string
  address: Address
  client: WalletClient
}

/**
 * Returns a memoized key getter backed by `createKeySession`. The first
 * call triggers the personal_sign; later calls reuse the derived
 * CryptoKey, which is wiped on accountsChanged / chainChanged / tab
 * close.
 */
export function makeKeyProvider(session: Session): () => Promise<CryptoKey> {
  const keySession = createKeySession({
    address: session.address,
    derive: () =>
      deriveWalletEncryptionKey({
        signer: session.client,
        purpose: KEY_PURPOSE,
        version: KEY_VERSION,
      }),
    provider:
      typeof window !== 'undefined'
        ? (window.ethereum as Eip1193Like | undefined)
        : undefined,
  })
  return () => keySession.getKey()
}
```

- [ ] **Step 3: Repoint the wallet helper's error import to `wallet-crypto`**

In `examples/encrypted-vault/src/lib/wallet.ts`, change the import and the doc comment. Replace:

```ts
 * Throws WalletUnavailable when no provider is present so the caller
 * can handle the wallet surface with one catch (shared error class
 * across auth-lite + wallet-crypto).
 */
import { createWalletClient, custom, type Address, type WalletClient } from 'viem'
import { WalletUnavailable } from '@valve-tech/auth-lite'
```

with:

```ts
 * Throws WalletUnavailable when no provider is present so the caller
 * can handle the wallet surface with one catch (the same error class
 * @valve-tech/wallet-crypto throws on a disconnected wallet).
 */
import { createWalletClient, custom, type Address, type WalletClient } from 'viem'
import { WalletUnavailable } from '@valve-tech/wallet-crypto'
```

- [ ] **Step 4: Fix the stale `auth-lite` comment in `blob.ts`**

In `examples/encrypted-vault/src/lib/blob.ts`, change the comment that reads:

```ts
   * auth nonce from @valve-tech/auth-lite (same word, different concept).
```

to:

```ts
   * SIWE nonce from viem/siwe / @valve-tech/siwe-store (same word, different concept).
```

- [ ] **Step 5: Rewrite the App sign-in to sign the SIWE message directly**

In `examples/encrypted-vault/src/App.tsx`:

(a) Replace the imports block at the top. Remove the `signAuthChallenge` import from `@valve-tech/auth-lite`, and change the api import to use `fetchChallenge`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { encryptEnvelope, decryptEnvelope, WalletDeclined, WalletUnavailable } from '@valve-tech/wallet-crypto'
import { isUserRejectionError } from '@valve-tech/viem-errors'
import { connectWallet } from './lib/wallet.js'
import { fetchChallenge, verifySignature, fetchNotes, postNote, AuthError } from './lib/api.js'
import { makeKeyProvider, type Session } from './lib/session.js'
import { encodeBlob, decodeBlob } from './lib/blob.js'
import { SignInCard } from './components/SignInCard.js'
import { IdentityBar } from './components/IdentityBar.js'
import { Composer } from './components/Composer.js'
import { NoteList, type NoteRow } from './components/NoteList.js'
```

(b) Delete the now-unused `const APP_NAME = 'Encrypted Vault'` line.

(c) Replace the body of the `signIn` callback (the `try` block) with the SIWE flow:

```ts
  const signIn = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const { client, address } = await connectWallet()
      const chainId = await client.getChainId()
      const message = await fetchChallenge(address, chainId)
      const signature = await client.signMessage({ account: address, message })
      const verified = await verifySignature({ message, signature })
      const next: Session = { token: verified.token, address: verified.address, client }
      setSession(next)
      setGetKey(() => makeKeyProvider(next))
    } catch (err) {
      handleWalletError(err)
    } finally {
      setBusy(false)
    }
  }, [handleWalletError])
```

(The rest of `App.tsx` — `handleWalletError`, `signOut`, the notes effect, `addNote`, `decryptNote`, and the render — is unchanged.)

(d) Update the file's top doc comment first line so it no longer says "sign in (auth-lite)":

```ts
 * Vault state machine. Signed-out → connect + sign in (viem/siwe) →
```

- [ ] **Step 6: Update the HTML meta description**

In `examples/encrypted-vault/index.html`, replace the meta `content` that ends with `Demonstrates @valve-tech/auth-lite + @valve-tech/wallet-crypto.` with:

```html
        content="Sign in with your wallet and write private notes encrypted to your wallet. The server stores ciphertext only and is cryptographically blind to your notes. Demonstrates viem/siwe + @valve-tech/siwe-store + @valve-tech/wallet-crypto + @valve-tech/wallet-key-session."
```

- [ ] **Step 7: Rewrite the README's auth framing**

In `examples/encrypted-vault/README.md`, replace the line:

```markdown
Pairs [`@valve-tech/auth-lite`](../../packages/auth-lite) (SIWE-lite session login) with [`@valve-tech/wallet-crypto`](../../packages/wallet-crypto) (wallet-derived AES-GCM encryption).
```

with:

```markdown
Pairs full EIP-4361 SIWE ([`viem/siwe`](https://viem.sh/docs/siwe) + [`@valve-tech/siwe-store`](../../packages/siwe-store) for the server-side nonce + session state) with [`@valve-tech/wallet-crypto`](../../packages/wallet-crypto) (wallet-derived AES-GCM encryption) and [`@valve-tech/wallet-key-session`](../../packages/wallet-key-session) (the memory-only key lifecycle).
```

And replace the table row:

```markdown
| Wallet login (auth-lite SIWE-lite) | `signAuthChallenge` → server `verifyAuthSignature` → opaque session token |
```

with:

```markdown
| Wallet login (full EIP-4361 SIWE) | server `createSiweMessage` (nonce from `siwe-store`) → client `signMessage` → server `parseSiweMessage` + `nonceStore.consume` + `validateSiweMessage` + `recoverMessageAddress` → opaque session token |
```

- [ ] **Step 8: Typecheck both halves of the example**

Run: `yarn workspace @valve-tech/example-encrypted-vault typecheck`
Expected: PASS — both `tsconfig.json` (client) and `tsconfig.server.json` (server) typecheck clean.

- [ ] **Step 9: Lint the example**

Run: `yarn workspace @valve-tech/example-encrypted-vault lint`
Expected: PASS (no `auth-lite` import left; no unused `APP_NAME`).

- [ ] **Step 10: Build the example end-to-end**

Run: `yarn workspace @valve-tech/example-encrypted-vault build`
Expected: PASS — `tsc -p tsconfig.json`, `tsc -p tsconfig.server.json`, and `vite build` all succeed.

- [ ] **Step 11: Commit**

```bash
git add examples/encrypted-vault
git commit -m "feat(examples): encrypted-vault — client uses viem/siwe + wallet-key-session"
```

---

### Task 5: Remove `@valve-tech/auth-lite` and clean every reference

**Files:**
- Delete: `packages/auth-lite/` (entire directory)
- Modify: `.github/workflows/release.yml` (remove the auth-lite Publish step)
- Modify: `package.json` (root — remove auth-lite from `typecheck:examples`)
- Modify: `packages/agent-skills/skills/building-apps-with-evm-toolkit/SKILL.md`
- Modify: `packages/wallet-crypto/src/index.ts` (fileoverview cross-ref)
- Modify: `packages/wallet-crypto/src/envelope.ts` (nonce-collision warning)
- Modify: `packages/wallet-crypto/README.md` (pitfall #1 + composition)
- Modify: `packages/wallet-crypto/AGENTS.md` (pitfall #1 + composition)
- Modify: `packages/wallet-crypto/skills/wallet-crypto-integration/SKILL.md` (description + pitfall + composition + sibling pointer)
- Modify: `CHANGELOG.md` (root — add an `[Unreleased]` removal note)
- **Do NOT touch** historical `[0.18.0]` CHANGELOG entries in the root or in `packages/{chain-source,gas-oracle,tx-tracker,wallet-adapter,trueblocks-sdk,tx-flight-react,wallet-crypto}/CHANGELOG.md` — those are immutable history.

> **Maintainer-only, out of band (not a code step):** run
> `npm deprecate @valve-tech/auth-lite "redundant with viem/siwe; use viem/siwe for crypto + @valve-tech/siwe-store for state"`. Published
> versions stay; this is forward-deprecation. Note it in the PR/commit body.

- [ ] **Step 1: Delete the package**

```bash
git rm -r packages/auth-lite
```

- [ ] **Step 2: Remove the auth-lite publish step from `release.yml`**

In `.github/workflows/release.yml`, delete the entire step:

```yaml
      - name: Publish @valve-tech/auth-lite
        run: |
          cd packages/auth-lite
          yarn pack --out=/tmp/auth-lite.tgz
          npm publish /tmp/auth-lite.tgz --access public --provenance
```

- [ ] **Step 3: Remove auth-lite from the root `typecheck:examples`**

In the root `package.json`, delete the ` && yarn workspace @valve-tech/auth-lite run typecheck:examples` segment. The line becomes:

```json
    "typecheck:examples": "yarn workspace @valve-tech/gas-oracle run typecheck:examples && yarn workspace @valve-tech/wallet-adapter run typecheck:examples && yarn workspace @valve-tech/wallet-crypto run typecheck:examples && yarn workspace @valve-tech/wallet-key-session run typecheck:examples && yarn workspace @valve-tech/siwe-store run typecheck:examples",
```

- [ ] **Step 4: Rewrite Recipe 3 + ownership map + references in the building-apps skill**

In `packages/agent-skills/skills/building-apps-with-evm-toolkit/SKILL.md`:

(a) In the YAML `description`, change the integration-skill list — replace `auth-lite-integration, wallet-crypto-integration` with `wallet-key-session-integration, siwe-store-integration, wallet-crypto-integration` (and keep the `add SIWE login plus a transaction strip` phrasing, which is still accurate).

(b) Replace the `@valve-tech/auth-lite` ownership bullet:

```markdown
- **`@valve-tech/auth-lite`** — SIWE-lite login: server `generateAuthNonce`
  → client `signAuthChallenge` → server `verifyAuthSignature` (plus
  `formatAuthMessage`). Narrower than full EIP-4361 by design. → `auth-lite-integration`
```

with two bullets:

```markdown
- **`@valve-tech/siwe-store`** — the *server* state for full EIP-4361
  SIWE that `viem/siwe` leaves to the app: a single-use/TTL nonce store
  (`createMemoryNonceStore`) and an opaque address-bound session store
  (`createMemorySessionStore`). The SIWE crypto/message/validation
  itself is `viem/siwe` (`createSiweMessage`, `parseSiweMessage`,
  `validateSiweMessage`, `generateSiweNonce`). → `siwe-store-integration`
- **`@valve-tech/wallet-key-session`** — the *client* memory-only
  lifecycle of a wallet-derived encryption key: `createKeySession`
  (derive-once, wipe on account-change / tab-close). Pairs
  `wallet-crypto`. → `wallet-key-session-integration`
```

(c) Update the `wallet-crypto` ownership bullet's trailer `Pairs with auth-lite (shared typed errors).` to `Pairs with wallet-key-session (key lifecycle) and viem/siwe + siwe-store (auth).`

(d) Replace Recipe 3 in full:

```markdown
## Recipe 3 — login + wallet-encrypted data

Full EIP-4361 SIWE login + wallet-derived encryption. `viem/siwe` owns
the SIWE crypto; the two valve packages own the state `viem/siwe`
leaves to you.

- **Login (server)**: `nonce = nonceStore.issue()` →
  `createSiweMessage({ domain, uri, address, chainId, nonce, statement,
  issuedAt, expirationTime })`. Binding fields come from server config,
  never the request.
- **Login (client)**: `walletClient.signMessage({ message })` → POST
  `{ message, signature }`.
- **Verify (server)**: `parseSiweMessage(message)` →
  `nonceStore.consume(fields.nonce)` (single-use/replay) →
  `validateSiweMessage({ message, domain })` (domain + time) →
  `recoverMessageAddress({ message, signature }) === fields.address`
  (crypto) → `sessionStore.issue(fields.address)`. Any failure → 401.
- **Encrypt user data to their wallet**: wire
  `deriveWalletEncryptionKey` (wallet-crypto) into
  `createKeySession({ address, derive, provider })`
  (wallet-key-session), then `encryptEnvelope` / `decryptEnvelope`.

The `nonceStore` / `sessionStore` are `@valve-tech/siwe-store`; the key
lifecycle is `@valve-tech/wallet-key-session`. The two are independent
of the chain-watching half. A runnable end-to-end wiring is the
`encrypted-vault` example.
```

(e) In the "Where to look next → Runnable references" line, change the package list `(gas-oracle, wallet-adapter, auth-lite, wallet-crypto)` to `(gas-oracle, wallet-adapter, wallet-crypto, wallet-key-session, siwe-store)`.

- [ ] **Step 5: Repoint `wallet-crypto`'s source cross-references**

In `packages/wallet-crypto/src/index.ts`, replace the fileoverview lines:

```ts
 * Wallet-derived encryption keys + AES-GCM authenticated envelopes.
 * Pairs with `@valve-tech/auth-lite` (typed errors are intentionally
 * named the same where they overlap so consumers catch one class once).
 */
```

with:

```ts
 * Wallet-derived encryption keys + AES-GCM authenticated envelopes.
 * Pairs with `@valve-tech/wallet-key-session` (the memory-only
 * lifecycle of the derived key). SIWE auth is `viem/siwe` +
 * `@valve-tech/siwe-store`.
 */
```

In `packages/wallet-crypto/src/envelope.ts`, replace:

```ts
 * field returned and consumed by these functions is the AES-GCM
 * 12-byte IV. It is NOT the auth nonce from
 * `@valve-tech/auth-lite`'s `generateAuthNonce`. Different concept,
 * unfortunate name collision in the crypto literature. Don't pass
 * one where the other is expected.
```

with:

```ts
 * field returned and consumed by these functions is the AES-GCM
 * 12-byte IV. It is NOT the SIWE nonce from `viem/siwe`'s
 * `generateSiweNonce` / `@valve-tech/siwe-store`. Different concept,
 * unfortunate name collision in the crypto literature. Don't pass
 * one where the other is expected.
```

- [ ] **Step 6: Repoint `wallet-crypto`'s README + AGENTS + SKILL cross-references**

In `packages/wallet-crypto/README.md`:
- Pitfall #1: change `The auth nonce from \`@valve-tech/auth-lite\` is unrelated.` to `The SIWE nonce from \`viem/siwe\` / \`@valve-tech/siwe-store\` is unrelated.`
- Composition section: replace the `@valve-tech/auth-lite` bullet with:
  ```markdown
  - **`@valve-tech/wallet-key-session`** — the memory-only lifecycle of
    the key this package derives (derive-once, wipe on account-change /
    tab-close). Wire `deriveWalletEncryptionKey` into its `derive`
    callback. For auth, use `viem/siwe` + `@valve-tech/siwe-store`.
  ```

In `packages/wallet-crypto/AGENTS.md`:
- Pitfall #1 (`The \`nonce\` returned by \`encryptEnvelope\` ... NOT the auth nonce from \`@valve-tech/auth-lite\`.`): change `auth nonce from \`@valve-tech/auth-lite\`` to `SIWE nonce from \`viem/siwe\` / \`@valve-tech/siwe-store\``.
- Composition section (`With \`@valve-tech/auth-lite\`: pair them when a product needs both auth + encrypted storage...`): replace that bullet with one describing `@valve-tech/wallet-key-session` (key lifecycle) and noting auth is `viem/siwe` + `@valve-tech/siwe-store`.

In `packages/wallet-crypto/skills/wallet-crypto-integration/SKILL.md`:
- In the YAML `description`, change the trailing `Skip when the user is going through \`@valve-tech/auth-lite\` for authentication only (no encryption)...` to `Skip when the user only needs SIWE authentication (no encryption) — that's \`viem/siwe\` + \`siwe-store-integration\`; this skill is the encryption half.`
- Pitfall #1: change `auth nonce from \`@valve-tech/auth-lite\`` to `SIWE nonce from \`viem/siwe\` / \`@valve-tech/siwe-store\``.
- "Composition with sibling packages": replace the `@valve-tech/auth-lite` bullet (and its shared-error-name `catch` example, which is still valuable) so it reads as pairing with `@valve-tech/wallet-key-session`. Keep the `err.name === 'WalletDeclined'` guidance but frame it as discriminating the rejected `getKey()` promise. Point auth at `viem/siwe` + `siwe-store-integration`.
- "Where to find more → Sibling skill": change the `auth-lite-integration` pointer to `wallet-key-session-integration` (at `node_modules/@valve-tech/wallet-key-session/skills/...`) and add `siwe-store-integration`.

- [ ] **Step 7: Record the change in the root CHANGELOG**

In `CHANGELOG.md`, insert a new section directly under the title/intro block and ABOVE `## [0.18.0] — 2026-06-01`:

```markdown
## [Unreleased]

### Removed

- **`@valve-tech/auth-lite`** is removed. `viem/siwe` (shipped in the
  viem the toolkit already peer-depends on) owns the entire SIWE
  crypto + message + validation surface, so the thin wrapper was
  redundant. Existing published versions remain on npm
  (forward-deprecated). Use `viem/siwe` for the crypto and the two new
  packages for the state.

### Added

- **`@valve-tech/wallet-key-session`** (browser) — the memory-only
  lifecycle of a wallet-derived encryption key: `createKeySession`
  (derive-once, concurrent-safe, retry-on-reject; auto-wipe on
  `accountsChanged` / `chainChanged` / `pagehide` / `clear()`). Pairs
  `@valve-tech/wallet-crypto`.
- **`@valve-tech/siwe-store`** (server) — the single-use/TTL SIWE nonce
  store (`createMemoryNonceStore`) and the opaque address-bound session
  store (`createMemorySessionStore`), plus the `NonceStore` /
  `SessionStore` interfaces as the contract for Redis/SQL backends.
  Pairs `viem/siwe`.

### Changed

- `examples/encrypted-vault` reworked to use full EIP-4361 SIWE
  (`viem/siwe`) and to dogfood `@valve-tech/siwe-store` (server state)
  and `@valve-tech/wallet-key-session` (client key lifecycle).
- `@valve-tech/wallet-crypto` docs/comments repointed from the removed
  `auth-lite` to `wallet-key-session` (key lifecycle) and `viem/siwe` +
  `siwe-store` (auth).
```

- [ ] **Step 8: Confirm no dangling auth-lite references remain (outside historical CHANGELOGs and this plan)**

Run:
```bash
grep -rn "auth-lite\|authLite\|signAuthChallenge\|verifyAuthSignature\|generateAuthNonce\|formatAuthMessage" \
  --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" --include="*.yml" --include="*.mjs" \
  . | grep -v "/node_modules/" | grep -v "/dist/" | grep -v "/dist-server/" | grep -v "/coverage/" \
      | grep -v "docs/api/" | grep -v "docs/superpowers/" \
      | grep -v "CHANGELOG"
```
Expected: NO output. (Hits inside per-package `CHANGELOG.md` historical `[0.18.0]` entries are expected and must remain; `docs/api/` is regenerated in Task 6; `docs/superpowers/` holds the spec/plan and is fine.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: remove @valve-tech/auth-lite; repoint refs to viem/siwe + siwe-store + wallet-key-session"
```

---

### Task 6: Regenerate docs and run the full verification gate

**Files:**
- Modify (generated): `docs/api/manifest.json`, `docs/api/wallet-key-session.json`, `docs/api/siwe-store.json`, `docs/api/wallet-key-session/**`, `docs/api/siwe-store/**` (added); `docs/api/auth-lite.json` + `docs/api/auth-lite/**` (removed) — all via `yarn docs:build`, do not hand-edit.

- [ ] **Step 1: Regenerate the API docs artifacts**

The docs builder auto-discovers packages (it reads `packages/*/package.json`), so it picks up the two new packages and drops `auth-lite` on its own.

Run: `yarn docs:build`
Expected: log lines `building @valve-tech/siwe-store`, `building @valve-tech/wallet-key-session`, and `wrote docs/api/manifest.json`. The `auth-lite` HTML dir + JSON are purged (the builder removes generated artifacts for packages that no longer exist).

- [ ] **Step 2: Confirm the docs check is clean**

Run: `yarn docs:check`
Expected: `✓ docs/api/*.json all match source`.

- [ ] **Step 3: Run the full clean verification chain**

Run: `yarn verify:clean`
Expected: PASS through `build`, `lint`, `typecheck`, `typecheck:examples`, `test`, `verify:persisted-types`. This wipes `dist/` first, so it catches any cross-package build-ordering issue from adding/removing packages.

- [ ] **Step 4: Run the release-coverage check**

Run: `yarn verify:release-coverage`
Expected: `✓ release.yml covers all N publishable workspace packages.` (N reflects the two additions and the auth-lite removal; the count goes from 11 to 12.)

- [ ] **Step 5: Smoke-test the reworked example end-to-end (build + server boot + auth roundtrip)**

Build, then boot the server and exercise the SIWE challenge/verify path with a local viem account (no browser wallet needed):

```bash
yarn workspace @valve-tech/example-encrypted-vault build
PORT=8790 SIWE_DOMAIN=localhost:8790 SIWE_URI=http://localhost:8790 SIWE_CHAIN_ID=1 \
  node examples/encrypted-vault/dist-server/server/server.js &
SERVER_PID=$!
sleep 1
yarn dlx tsx -e '
import { privateKeyToAccount } from "viem/accounts";
const acct = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const c = await (await fetch(`http://localhost:8790/auth/challenge?address=${acct.address}&chainId=1`)).json();
const signature = await acct.signMessage({ message: c.message });
const v = await (await fetch("http://localhost:8790/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: c.message, signature }) })).json();
console.log("verify →", v.address ? "OK " + v.address : v);
const replay = await (await fetch("http://localhost:8790/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: c.message, signature }) })).status;
console.log("nonce replay → expect 401, got", replay);
'
kill $SERVER_PID
```
Expected: `verify → OK 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` and `nonce replay → expect 401, got 401` (the single-use nonce store rejects the replay).

- [ ] **Step 6: Commit the regenerated docs**

```bash
git add docs/api
git commit -m "docs(api): regenerate — add wallet-key-session + siwe-store, drop auth-lite"
```

---

## Post-implementation (maintainer, out of band)

These are NOT code steps in this plan; they belong to the release flow.

- Run `npm deprecate @valve-tech/auth-lite "redundant with viem/siwe; use viem/siwe for crypto + @valve-tech/siwe-store for state"`.
- Cut the synchronized release (bump every package + the two new ones to the next version, update CHANGELOGs, tag) per `.claude/skills/releasing-evm-toolkit/SKILL.md`. The first publish of each brand-new package (`wallet-key-session`, `siwe-store`) needs the manual-first-publish dance (claim the npm name + configure the trusted-publisher record) before the OIDC workflow can publish them.

## Self-Review notes

- **Spec coverage:** Part 1 (remove auth-lite) → Task 5. Part 2 (wallet-key-session) → Task 1. Part 3 (siwe-store) → Task 2. Part 4 (rework example, server + client) → Tasks 3 + 4. "Testing, gates, release" → Tasks 1/2 (per-package gates, AGENTS/README/SKILL/example), Task 5 (building-apps Recipe 3, release.yml publish steps), Task 6 (`verify:clean`, `verify:release-coverage`, `docs:build`). The `npm deprecate` and the synchronized release bump are maintainer actions, captured under "Post-implementation".
- **Beyond the spec's audit:** the spec's Part 1 reference list omitted (a) `ci.yml`'s `docs:check` gate — covered by Task 6's `docs:build`; and (b) `@valve-tech/wallet-crypto`'s own source/README/AGENTS/SKILL cross-references to `auth-lite` — covered by Task 5 Steps 5–6. Both would otherwise leave dangling references to a deleted package.
- **Type consistency:** `KeySession` / `createKeySession` / `Eip1193Like` (Task 1) are consumed verbatim in Task 4's `session.ts`. `NonceStore.consume → boolean`, `SessionStore.validate → Session | null` (Task 2) are consumed verbatim in Task 3's `server.ts` (`session.address`). The client/server wire contract (`/auth/challenge` → `{ message }`, `/auth/verify { message, signature }` → `{ token, address }`) is defined once in Task 3's Interfaces and matched in Task 4's `api.ts`.
