# Changelog

All notable changes to `@valve-tech/wallet-crypto` are documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
