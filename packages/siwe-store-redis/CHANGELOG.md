# Changelog

All notable changes to `@valve-tech/siwe-store-redis` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release. `createRedisNonceStore` (single-use SIWE nonces —
  atomic consume via Redis `DEL`, TTL via `SET … PX`) and
  `createRedisSessionStore` (opaque CSPRNG tokens bound to an address,
  Redis-expiry TTL), implementing `@valve-tech/siwe-store`'s
  `AsyncNonceStore` / `AsyncSessionStore` contracts.
- Bring-your-own-client design: stores type against the minimal
  `RedisClientLike` surface (zero runtime dependencies). node-redis v4
  matches directly; `fromNodeRedisV5` and `fromIoRedis` adapters ship
  in the package.
