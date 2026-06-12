# Changelog

All notable changes to `@valve-tech/auth-lite` are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Integration skill (2026-06-12 audit): corrected the shared-error
  wording — auth-lite and wallet-crypto share error NAMES, not classes,
  so cross-package catch arms must discriminate on
  `err.name === 'WalletDeclined'` rather than a single-import
  `instanceof`; documented the `generateAuthNonce` bounds (bytes 16-64,
  ttlSeconds 30-3600, `RangeError` outside); added the wallet-crypto
  sibling-skill pointer and the standard "Where to find more" block;
  trimmed the description under 1024 chars.

## [0.18.0] — 2026-06-01

### Added

- Initial release. SIWE-lite authentication primitives for viem-based
  dapps. Server-issued nonce → client `personal_sign` → server
  `recoverMessageAddress`. Plain-text wallet prompt, single-app threat
  model, no domain/URI/chainId/issuedAt bookkeeping.

  Three core primitives:

  - **`generateAuthNonce({ bytes?, ttlSeconds? })`** — base64url
    nonce + `expiresAt` timestamp. Defaults: 32 bytes, 5 minute TTL.
    Bounds: `bytes` ∈ [16, 64], `ttlSeconds` ∈ [30, 3600]. Caller
    owns persistence and single-use enforcement.

  - **`signAuthChallenge({ signer, app, nonce })`** — client-side
    `personal_sign` wrapper. Throws `InvalidNonce` (structural
    sanity), `WalletDeclined` (rejection), `WalletUnavailable` (no
    account). Returns `{ address, signature, message }`.

  - **`verifyAuthSignature({ app, nonce, signature, claimedAddress })`** —
    server-side. Returns `Address` on success, `null` on any failure
    (bad sig, address mismatch, malformed input). Single-null return
    deliberately doesn't leak which check failed.

- Shared template helpers (`formatAuthMessage`,
  `AUTH_MESSAGE_TEMPLATE`) — both sides use these so the signed
  plaintext has one source of truth.

- Four typed error classes (`WalletDeclined`, `WalletUnavailable`,
  `InvalidNonce`, `SignatureMismatch`) — `instanceof`-checkable.
  `WalletDeclined` + `WalletUnavailable` match the names in
  `@valve-tech/wallet-crypto` so consumers using both packages can
  write one catch arm.

- 100% statement / branch / function / line coverage. Tests verify:
  10,000-call nonce uniqueness, byte/TTL bounds, known-good
  signature verification, bit-flip rejection, cross-app rejection,
  cross-nonce rejection, address-mismatch rejection, rejection-path
  null-return safety, client-side nonce structural sanity.

- Skill (`skills/auth-lite-integration/SKILL.md`) ships in the
  tarball for AI agents in consumer projects.

### Notes

- Joins the `valve-tech/evm-toolkit` synchronized release line at
  v0.18.0 alongside its sibling package `@valve-tech/wallet-crypto`.
- Implements the consumer contract specified in
  `trace/docs/superpowers/specs/2026-06-01-evm-toolkit-siwe-encryption-contract.md`
  (the auth half).
- Full EIP-4361 SIWE deferred to a future package — explicitly out
  of scope per the consumer contract. Use this package for single-app
  auth; reach for full SIWE only when you need cross-app session
  portability.
