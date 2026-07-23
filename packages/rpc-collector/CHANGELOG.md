# Changelog

All notable changes to `@valve-tech/rpc-collector` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.21.0] — 2026-07-22

Manual first publish (npm name-claim); joined the synced release line
mid-cycle, after the toolkit-wide v0.21.0 tag of 2026-07-15.

### Added

- Initial release. `collectRpcs` resolves a chainId or chain name to its
  public RPC endpoints from the vendored DefiLlama/chainlist dataset,
  ordered privacy-first (`none` → `limited` → `unspecified` → `unknown` →
  `yes`) with no silent filtering.
- `toViemTransport` (`@valve-tech/rpc-collector/viem`) and
  `toEthersProvider` (`@valve-tech/rpc-collector/ethers`) build a viem
  fallback transport or an ethers `FallbackProvider` from collected
  endpoints, in `fallback` or `loadBalance` mode.
- `probeEndpoints` opt-in liveness and latency check.
- Zero runtime dependencies — the dataset is compiled into the package at
  build time; viem and ethers are optional peers.
