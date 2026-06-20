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
