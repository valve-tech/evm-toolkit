# `examples/encrypted-vault` — auth-lite + wallet-crypto example — design spec

**Date:** 2026-06-15
**Status:** approved, ready for implementation plan
**Example set:** 3 of 3 (write-path · gas dashboard · auth+crypto) — see the
companion specs dated 2026-06-15.

## Goal

A wallet-login encrypted notes vault: sign in with your wallet, write private
notes that are encrypted to your wallet, read them back decrypted. It is the
only concept that exercises **both** of the two packages nothing else in the
toolkit touches:

- **`@valve-tech/auth-lite`** — SIWE-lite login (server nonce → client sign →
  server verify)
- **`@valve-tech/wallet-crypto`** — wallet-derived AES-GCM encryption

The point it proves: a server can **persist your data yet be cryptographically
blind to it**, because the key is derived from your wallet client-side.

## Non-goals

- No key-rotation UI (`wallet-crypto` supports a version bump — noted as a
  possible later add).
- No note sharing between users.
- No real database — a simple JSON-file ciphertext store, flagged as such.
- No non-wallet auth fallback.

## Structural note — this example has a backend

Unlike `tx-write-flight` and `gas-dashboard` (fully static), this example
**needs a server**: `auth-lite`'s `generateAuthNonce` / `verifyAuthSignature`
are server-side by design. The server is a minimal plain-Node HTTP server in
the same dependency-light style as `unchained-index-server`.

## Architecture

Single workspace `@valve-tech/example-encrypted-vault` (`"private": true`,
`@valve-tech/example-` prefix) with two halves:

- **Client** — Vite + React + TS; a thin injected EIP-1193 wallet (same adapter
  style as `tx-write-flight`).
- **Server** — minimal plain-Node HTTP server: auth endpoints, the opaque
  session layer, and the address-scoped ciphertext store.

Dependencies: `@valve-tech/auth-lite`, `@valve-tech/wallet-crypto`, `viem`,
`react`, `react-dom` (example-only). In **production** the Node server serves
the built client; in **dev**, Vite proxies `/auth` and `/notes` to the server.
Picked up by root `yarn build` / `lint` / `typecheck` / `test`; never publishes.

## Flow (the two-package pairing)

1. **Connect** wallet (injected EIP-1193).
2. **Sign in** (`auth-lite`): client `GET /auth/nonce` → `signAuthChallenge`
   (`personal_sign`) → `POST /auth/verify` → server `verifyAuthSignature`.
3. **Session**: on successful verify the server issues an **opaque session
   token** (random, in-memory `token → address` map, short TTL) returned to the
   client; the client sends it as a `Bearer` header on `/notes` calls.
   `auth-lite` deliberately stops at verify and issues no session — the example
   layering its own minimal session on top is itself the teaching point about
   that boundary.
4. **Unlock encryption** (`wallet-crypto`): `deriveWalletEncryptionKey` from a
   `personal_sign` (purpose `"notes-vault"`, version `1`) → a non-extractable
   AES-GCM `CryptoKey`, derived **lazily on first encrypt/decrypt**. Two
   signatures total (auth + key); the README explains why they are distinct.
5. **Add note**: `encryptEnvelope(key, text, AAD = address)` → `POST /notes`
   with the Bearer token → server stores **ciphertext only**, keyed by the
   verified address.
6. **List / read**: `GET /notes` (Bearer) → ciphertext blobs → `decryptEnvelope`
   on tap (locked rows decrypt on demand).

## What it proves

- **Server blindness** — the store holds only ciphertext; the server cannot
  read a note.
- **Cross-device determinism** — `deriveWalletEncryptionKey` is deterministic
  (same wallet + purpose + version → same key), so signing in from another
  browser decrypts the same notes. The README demonstrates this explicitly.

## Layout (Layout A — centered single-column vault)

- **Signed-out**: a centered card — "sign in with your wallet to unlock your
  notes" → Connect & sign in.
- **Signed-in**: one focused card — identity bar (address + session badge +
  sign out) on top, an add-note composer ("write a private note…" → Encrypt &
  save), then the note list. Decrypted notes read plainly; encrypted notes show
  locked and decrypt on tap.

## Error handling

- Both packages share typed errors (`WalletDeclined` / `WalletUnavailable`) by
  design — caught once for the whole wallet surface.
- `isUserRejectionError` keeps a wallet-cancel quiet (no scary banner).
- Auth failures — bad / expired / replayed nonce, invalid signature, expired or
  missing session — return clear `401`s the client surfaces plainly.

## Storage & testing

- Ciphertext store: a simple JSON file (survives restart), keyed by address.
  README flags "a real app uses a database."
- **Server-side Vitest** covers the security-critical logic:
  - nonce issue / expiry / one-time-use (no replay),
  - session token issue / validate / expiry,
  - address-scoped note isolation (one user cannot read another's blobs).
- Minimal client-side unit tests for any pure helpers. `yarn build` builds both
  halves and is the CI gate, plus `lint` / `typecheck`. Manual end-to-end run
  documented in the README; signing flows are not unit-tested (no wallet in CI).

## Aesthetic direction

A "private vault / safe" identity — distinct from `tx-write-flight`'s flight
board, `gas-dashboard`'s instrument cluster, and `unchained-tx-history`'s
graffiti corridor. Detailed visual pass tracked as the separate cross-cutting
theming task.

## Out of scope / later

- Theming pass (shared visual identity across the examples) — separate task.
- Key rotation (version bump + re-encrypt), note sharing, real DB, non-wallet
  auth — see Non-goals.
