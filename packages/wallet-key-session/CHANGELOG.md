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
