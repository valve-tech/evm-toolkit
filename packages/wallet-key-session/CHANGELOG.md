# Changelog

All notable changes to `@valve-tech/wallet-key-session` are documented
here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to the valve-tech/evm-toolkit synchronized
release line.

## [Unreleased]

### Changed

- Declared `engines.node` as `>=20`. The packages are CI-tested on Node
  20, 22, and 24; this makes the supported range explicit for consumers.

## [0.20.0] — 2026-06-26

### Added

- `KeySession.dispose()` — tears the session down: `clear()`s the key
  AND removes the `accountsChanged` / `chainChanged` provider listeners
  and the `pagehide` window listener it registered. Idempotent. Call
  from an owner whose lifecycle is shorter than the page (e.g. a React
  `useEffect` cleanup) so repeated create/destroy cycles don't
  accumulate listeners. Purely additive — existing
  `getKey()` / `clear()` callers are unaffected.

## [0.19.0] — 2026-06-21

### Added

- Initial release. `createKeySession` owns the memory-only lifecycle
  of a wallet-derived encryption `CryptoKey`: derive-once (concurrent-
  safe, retry-on-reject), and auto-wipe on `accountsChanged` /
  `chainChanged` / `pagehide` / `clear()`. Browser-safe; the
  derivation is injected so the lifecycle is testable without a wallet.
  Pairs `@valve-tech/wallet-crypto`. Extracted from the stateful half
  of the removed `@valve-tech/auth-lite` design.
