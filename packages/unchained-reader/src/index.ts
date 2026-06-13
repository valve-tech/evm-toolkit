/**
 * `@valve-tech/unchained-reader` — browser-safe, zero-dependency reader
 * for the TrueBlocks Unchained Index.
 *
 * Resolve a manifest, fetch bloom filters + index chunks from any IPFS
 * gateway, and parse the binary formats client-side into address
 * appearances — no chifra daemon, no backend, no API key. The high-level
 * entry point is {@link createUnchainedReader}; the pure parsers
 * ({@link parseManifest}, {@link parseBloom}, {@link appearancesOf}) are
 * exported for direct use over `Uint8Array`.
 */

// Types
export type {
  Manifest,
  ManifestConfig,
  ChunkRef,
  BlockRange,
  Appearance,
  ChunkFailure,
} from './types.js'
export { FailureReason } from './types.js'

// Address helpers
export { normalizeAddress, addressToBytes, bytesToAddress } from './address.js'
export type { HexAddress } from './address.js'

// Pure parsing layer
export { parseManifest, ACCEPTED_VERSION } from './manifest.js'
export { parseBloom, mightContain } from './bloom.js'
export type { Bloom } from './bloom.js'
export { parseChunkHeader, appearancesOf } from './chunk.js'
export type { ChunkHeader } from './chunk.js'

// I/O layer
export { createFetcher } from './fetcher.js'
export type {
  Fetcher,
  FetcherConfig,
  FetchLike,
  FetchResponse,
  ChunkCache,
} from './fetcher.js'

// Orchestrator
export { createUnchainedReader } from './reader.js'
export type {
  UnchainedReader,
  ReaderConfig,
  GetAppearancesOptions,
  AppearancesResult,
  Progress,
} from './reader.js'
