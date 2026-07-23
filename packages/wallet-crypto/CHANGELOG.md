# Changelog

All notable changes to `@valve-tech/wallet-crypto` are documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.22.0] — 2026-07-23

### Notes

- Synchronized release — no changes to this package. Bumped in
  lockstep with the rest of the toolkit.

## [0.21.0] — 2026-07-15

### Added

- `rotateEnvelope({ oldKey, newKey, ciphertext, nonce, oldAad?, newAad? })`
  — re-wraps one envelope from a retired key to a new one, the per-blob
  step of a `version` rotation. Composes `decryptEnvelope` +
  `encryptEnvelope` in one call so the plaintext is never handed back
  and the AAD tag is swapped explicitly (`oldAad` → `newAad`). Throws
  `DecryptionFailed` and returns nothing to write on a key/nonce/AAD
  mismatch, so a failed rotation is non-destructive. Pure, stateless —
  the caller still owns its storage read/write loop and the "current
  version" flag.

### Changed

- Declared `engines.node` as `>=20`. The packages are CI-tested on Node
  20, 22, and 24; this makes the supported range explicit for consumers.

## [0.20.0] — 2026-06-26

### Notes

- Synchronized release — no changes to this package. Bumped in
  lockstep with the rest of the toolkit.

## [0.19.0] — 2026-06-21

### Fixed

- Integration skill (2026-06-12 audit): corrected the shared-error
  wording (distinct classes, shared names — discriminate on `err.name`
  across packages); covered `WalletUnavailable` in the
  common-situations section; documented the `usages` option; added a
  signer-dependent determinism caveat (smart accounts / MPC may break
  cross-device key reproduction) and the standard "Where to find more"
  block; trimmed the description under 1024 chars.

## [0.18.0] — 2026-06-01

### Added

- Initial release. Two primitives for wallet-gated dapps that need to
  cloud-sync encrypted blobs:

  - **`deriveWalletEncryptionKey({ signer, purpose, version, usages? })`**
    Deterministic 256-bit AES-GCM `CryptoKey`. Same wallet+purpose+
    version → same key, byte-for-byte, on any device. Implementation
    signs `formatKeyDerivationMessage(...)` via `personal_sign`,
    SHA-256s the signature, imports as `extractable: false`. Raw
    signature bytes never leave the function.

  - **`encryptEnvelope` / `decryptEnvelope`** WebCrypto AES-GCM with
    12-byte random IV per call + optional AAD binding. Single-state
    `DecryptionFailed` on any tamper/wrong-key/wrong-AAD failure
    (AEAD information-hiding is preserved — no leaking of which
    check failed).

- Three typed error classes (`WalletDeclined`, `WalletUnavailable`,
  `DecryptionFailed`) — `instanceof`-checkable, no `.message` parsing
  required.

- 100% statement / branch / function / line coverage. Tests verify:
  determinism, cross-purpose isolation, cross-version isolation,
  cross-wallet isolation, roundtrip across 1B/1KB/1MB sizes, AAD
  binding (downgrade prevention), tamper detection, wrong-key
  rejection, wrong-IV rejection, rejection-error pass-through to
  `WalletDeclined`.

- Skill (`skills/wallet-crypto-integration/SKILL.md`) ships in the
  tarball for AI agents in consumer projects.

### Notes

- Joins the `valve-tech/evm-toolkit` synchronized release line at
  v0.18.0 alongside its sibling package `@valve-tech/auth-lite`.
- Implements the consumer contract specified in
  `trace/docs/superpowers/specs/2026-06-01-evm-toolkit-siwe-encryption-contract.md`
  (the crypto half).
- Depends on `@valve-tech/viem-errors` for the `WalletDeclined`
  rejection detection path — consumers get the three-signal coverage
  (EIP-1193 4001 / class name / message regex) without importing
  viem-errors directly.
