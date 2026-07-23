# Changelog

All notable changes to `@valve-tech/siwe-store` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to the valve-tech/evm-toolkit synchronized
release line.

## [0.22.0] — 2026-07-23

### Added

- `AsyncNonceStore` / `AsyncSessionStore` — async variants of the
  store contracts for backends whose I/O is inherently asynchronous
  (Redis, SQL). Same semantics as the sync interfaces; implemented by
  the new `@valve-tech/siwe-store-redis` sibling package.
- `AnyNonceStore` / `AnySessionStore` — sync-or-async unions for
  handler code that always `await`s store results.

## [0.21.0] — 2026-07-15

### Changed

- Declared `engines.node` as `>=20`. The packages are CI-tested on Node
  20, 22, and 24; this makes the supported range explicit for consumers.

## [0.20.0] — 2026-06-26

### Notes

- Synchronized release — no changes to this package. Bumped in
  lockstep with the rest of the toolkit.

## [0.19.0] — 2026-06-21

### Added

- Initial release. `createMemoryNonceStore` (single-use, TTL'd, atomic
  delete-before-TTL-check) and `createMemorySessionStore` (opaque
  CSPRNG token bound to an address, with TTL + revoke). Ships the
  `NonceStore` / `SessionStore` interfaces as the contract for
  Redis/SQL backends. Pairs `viem/siwe`. Replaces the stateful nonce/
  session layer that the removed `@valve-tech/auth-lite` left to the
  caller.
