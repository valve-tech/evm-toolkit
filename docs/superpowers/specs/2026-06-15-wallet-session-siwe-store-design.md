# Replace `auth-lite` with `wallet-key-session` + `siwe-store` — design spec

**Date:** 2026-06-15
**Status:** approved (design), pending spec review → implementation plan
**Supersedes:** the `auth-lite` half of `2026-06-15-encrypted-vault-design.md`

## Why

`viem/siwe` (shipped in the viem the toolkit already peer-depends on) provides
the entire SIWE *crypto + message + validation* core: `createSiweMessage`,
`parseSiweMessage`, `validateSiweMessage`, `verifySiweMessage`,
`generateSiweNonce`. `@valve-tech/auth-lite` was a thin wrapper over that same
surface (it hand-rolled a narrower message + `recoverMessageAddress`), so it is
**redundant** and is being removed.

What `viem/siwe` deliberately does **not** own — because it is *stateful* and
app-specific — is the genuinely reusable, under-served gap:

1. **Client:** the memory-only lifecycle of a **wallet-derived encryption key**
   (pairs `@valve-tech/wallet-crypto`) — derive once per session, never
   persist, wipe on disconnect/account-change. No existing library owns this
   because no other toolkit ships wallet-derived encryption *and* SIWE; valve
   does.
2. **Server:** the **nonce single-use/TTL store** and **session issuance** —
   the replay defense and "still logged in" state, with the atomic-consume
   correctness encoded once.

We build two focused packages for those gaps and rework `encrypted-vault` to
use `viem/siwe` directly (full EIP-4361) and dogfood the new packages.

## Non-goals

- No SIWE message/crypto wrapper — consumers call `viem/siwe` directly.
- No Redis/SQL/cookie adapters shipped — `siwe-store` provides the
  **interfaces** + in-memory defaults; the README points at iron-session /
  Redis / NextAuth for production multi-instance state.
- No ERC-1271/6492 smart-account verification in the example (EOA-first; noted
  as an extension via a viem `PublicClient`).
- The theming pass is separate (resumes after this lands).

## Part 1 — Remove `@valve-tech/auth-lite`

- Delete `packages/auth-lite/`.
- Maintainer runs `npm deprecate @valve-tech/auth-lite "redundant with viem/siwe;
  use viem/siwe for crypto + @valve-tech/siwe-store for state"` (existing
  published versions stay; this is forward-deprecation).
- Clean every reference (audited):
  - `.github/workflows/release.yml` — remove the auth-lite publish step.
  - root `package.json` — drop `@valve-tech/auth-lite` from `typecheck:examples`.
  - `packages/agent-skills/skills/building-apps-with-evm-toolkit/SKILL.md` —
    rewrite Recipe 3 + the ownership map: SIWE crypto → `viem/siwe`; auth/key
    *state* → the two new packages.
  - `docs/api/manifest.json` + `docs/api/auth-lite.json` — regenerate via
    `yarn docs:build` (drops auth-lite, adds the two new packages).
  - root `CHANGELOG.md` + a final `packages/auth-lite/CHANGELOG.md` note are
    superseded by the removal; record the removal in the root CHANGELOG.
- Leaves the synced release line. Breaking, acceptable in 0.x.

## Part 2 — `@valve-tech/wallet-key-session` (client, browser-safe)

Pairs `@valve-tech/wallet-crypto`. Browser-safe (no node imports, **no
persistent storage of any kind**). Depends only on `viem` (types) at peer level.

```ts
export interface KeySession {
  readonly address: Address
  /** Lazily derive the key once; cache the (non-extractable) CryptoKey in
   *  memory only. Concurrent calls share one in-flight derivation. */
  getKey(): Promise<CryptoKey>
  /** Drop the cached key reference (e.g. on sign-out). */
  clear(): void
}

export interface Eip1193Like {
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

export function createKeySession(opts: {
  address: Address
  /** Consumer wires wallet-crypto here, e.g.
   *  () => deriveWalletEncryptionKey({ signer, purpose: 'notes-vault', version: 1 }).
   *  Injectable so the session is unit-testable without a wallet. */
  derive: () => Promise<CryptoKey>
  /** If supplied, auto-clear() on accountsChanged / chainChanged. */
  provider?: Eip1193Like
  /** Default true: also clear() on `pagehide` (tab close / bfcache evict). */
  clearOnPageHide?: boolean
}): KeySession
```

**Invariants:** the `CryptoKey` lives only in a closure variable; it is never
written to `localStorage` / `sessionStorage` / `IndexedDB` / cookies. `getKey()`
memoizes the *promise* (derive runs once even under concurrent callers).
`clear()` and any `accountsChanged`/`chainChanged`/`pagehide` event drop the
reference so the next `getKey()` re-derives (re-prompting the wallet). The
package never imports `node:*`.

**Tests** (no wallet needed — `derive` and `provider` are injectable):
- `getKey()` calls `derive` exactly once across multiple/concurrent calls.
- `clear()` forces the next `getKey()` to re-derive.
- a `provider` `accountsChanged` / `chainChanged` event triggers `clear()`.

## Part 3 — `@valve-tech/siwe-store` (server, Node)

Pairs `viem/siwe`. Node package (`generateSiweNonce` from `viem/siwe`,
`randomBytes` from `node:crypto`).

```ts
export interface NonceStore {
  /** Issue a fresh SIWE-valid nonce (generateSiweNonce) and remember it. */
  issue(): string
  /** True iff issued, unexpired, unconsumed. Deletes on hit (atomic single-use,
   *  delete-before-TTL-check so a race-loser cannot reuse). */
  consume(nonce: string): boolean
}
export function createMemoryNonceStore(opts?: { ttlSeconds?: number }): NonceStore

export interface Session {
  address: Address
  issuedAt: number
  claims?: Record<string, unknown>
}
export interface SessionStore {
  /** Opaque CSPRNG token (randomBytes base64url) bound to the address. */
  issue(address: Address, claims?: Record<string, unknown>): string
  /** The bound session if the token is valid + unexpired, else null. */
  validate(token: string): Session | null
  revoke(token: string): void
}
export function createMemorySessionStore(opts?: { ttlMs?: number }): SessionStore
```

The **interfaces** are the contract for Redis/SQL implementations; only the
in-memory adapters ship. README documents the production path (iron-session,
Redis, NextAuth) and that single-instance memory stores reset on restart.

**Tests** (promoted from the encrypted-vault example, TDD):
- nonce: issue → consume true; second consume false (no replay); expired →
  false; unknown → false; delete-before-TTL ordering.
- session: issue → validate returns the bound address; expired → null; revoke →
  null; unknown token → null.

## Part 4 — Rework `examples/encrypted-vault` to dogfood it

Dependency change: drop `@valve-tech/auth-lite`; add
`@valve-tech/wallet-key-session`, `@valve-tech/siwe-store`; keep
`@valve-tech/wallet-crypto`, `viem`. (`@valve-tech/viem-errors` stays for
`isUserRejectionError`.)

**Full EIP-4361 flow (server owns the binding fields):**
- `GET /auth/challenge?address=&chainId=` → `nonce = nonceStore.issue()`,
  `message = createSiweMessage({ domain, uri, address, chainId, nonce,
  statement, issuedAt, expirationTime })` → returns `{ message }`. `domain` /
  `uri` / `chainId` / `statement` come from server config (never the request).
- Client: `signMessage(message)` → `POST /auth/verify { message, signature }`.
- Server verify: `parseSiweMessage(message)` → fields; **`nonceStore.consume(
  fields.nonce)`** is the single-use/replay check (returns false → reject);
  `validateSiweMessage({ message, domain })` enforces the **domain binding +
  time validity** (`expirationTime`/`notBefore` vs now — viem checks these);
  `recoverMessageAddress({ message, signature }) === fields.address` is the
  crypto check; on success `token = sessionStore.issue(fields.address)` →
  `{ token, address }`. Any failure → uniform `401`. (Passing `nonce` to
  `validateSiweMessage` would be circular — issuance/single-use is the store's
  job, not a string-equality re-check.)
- Client sends `Bearer token` on `/notes` (unchanged gate, now backed by
  `siwe-store`'s `SessionStore`).

**Client key:** replace the hand-rolled `src/lib/session.ts` lazy provider with
`createKeySession({ address, derive: () => deriveWalletEncryptionKey({ signer,
purpose: 'notes-vault', version: 1 }), provider })`. Two signatures total (SIWE
auth + key derivation), exactly as before — but the key lifecycle is now the
package's audited memory-only one.

**Server:** delete `server/nonce-store.ts` + `server/session-store.ts`; use the
`siwe-store` memory adapters. `server/config.ts` gains `domain`, `uri`,
`chainId`, `statement`. The address-scoped **note-store stays** (it is the app's
data store, not auth state).

**README** reframes the demo as **viem/siwe (full SIWE) + wallet-crypto +
wallet-key-session + siwe-store**, and keeps the server-blindness / cross-device
determinism / two-signature narrative.

## Testing, gates, release

- Both new packages: vitest (the TDD above), `build`, `lint`, `typecheck`; each
  ships `AGENTS.md`, `README.md`, a `skills/*-integration/SKILL.md`, and a
  numbered `examples/` snippet (matching the other packages' convention).
- The `building-apps` skill's Recipe 3 is rewritten to wire viem/siwe + the two
  packages + wallet-crypto.
- `yarn verify:clean` + `yarn verify:release-coverage` must pass. The
  release-coverage verifier expects every non-private package to have a publish
  step in `release.yml` — so add publish steps for the two new packages and
  remove auth-lite's. First publish of a brand-new package needs the
  manual-first-publish dance (see the `releasing-evm-toolkit` skill).
- Example: `build` gate + the root integration check.

## Decisions captured

- Two packages, split by runtime: `wallet-key-session` (browser) +
  `siwe-store` (server).
- `auth-lite` removed, not kept as a wrapper.
- Memory adapters only; interfaces for Redis/SQL; iron-session/NextAuth named as
  the production alternatives.
- EOA verification in the example; smart-account verification noted as an
  extension.

## Out of scope / later

- Redis/SQL/cookie store adapters (interfaces only this round).
- The shared theming pass (resumes after this).
- Smart-account (ERC-1271/6492) verification path in the example.
