# Changelog

All notable changes to `@valve-tech/siwe-store-redis` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.22.0] — 2026-07-23

### Notes

- Synchronized release — no changes since the 0.21.0 manual first
  publish (npm name-claim). First version of this package published
  through the OIDC release workflow.

## [0.21.0] — 2026-07-23

Manual first publish (npm name-claim); joined the synced release line
mid-cycle, after the toolkit-wide v0.21.0 tag of 2026-07-15.

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
