/**
 * Shared types for `@valve-tech/unchained-reader`.
 *
 * The Unchained Index is a content-addressed set of "chunks", each a pair
 * of files: a bloom filter (fast probabilistic membership) and an index
 * (the authoritative address → appearances table). A manifest lists every
 * chunk's block range plus the IPFS CIDs and sizes of its two files.
 *
 * Numeric values that participate in math (block numbers, transaction
 * indices) are `bigint`; identifier-like sizes that only ever index byte
 * buffers stay `number`. See the contributing skill's bigint discipline.
 */

/** A half-open... no — an INCLUSIVE block range `[first, last]`. */
export interface BlockRange {
  first: bigint
  last: bigint
}

/** One chunk's metadata as it appears in the manifest. */
export interface ChunkRef {
  /** Inclusive block range this chunk covers. */
  range: BlockRange
  /** IPFS CID of the bloom filter file. */
  bloomHash: string
  /** Byte size of the bloom file (informational; bounds the fetch). */
  bloomSize: number
  /** IPFS CID of the index chunk file. */
  indexHash: string
  /** Byte size of the index file (informational; bounds the fetch). */
  indexSize: number
}

/** The Unchained Index manifest — the root document for a chain's index. */
export interface Manifest {
  /** Chain key (e.g. `mainnet`, `pulsechain`, `pulsechain-v4`). */
  chain: string
  /** IPFS CID of the binary-format specification this index was built to. */
  specification: string
  /** Builder version string, e.g. `trueblocks-core@v2.0.0-release`. */
  version: string
  /** Index build parameters. Passed through verbatim; not interpreted here. */
  config: ManifestConfig
  /** Every chunk, ascending by block range. */
  chunks: ChunkRef[]
}

/** Index build parameters carried in the manifest's `config` object. */
export interface ManifestConfig {
  appsPerChunk: number
  snapToGrid: number
  firstSnap: number
  unripeDist: number
  /** Present on newer manifests; whether chunks may be missing from the set. */
  allowMissing?: boolean
}

/**
 * A single address appearance: the address was seen in this transaction.
 * `transactionIndex` is the position of the tx within its block — feed
 * `(blockNumber, transactionIndex)` to
 * `eth_getTransactionByBlockNumberAndIndex` to hydrate the full tx.
 */
export interface Appearance {
  blockNumber: bigint
  transactionIndex: bigint
}

/**
 * Why a chunk could not be turned into appearances. Carried in the
 * reader's `failures` array so a partial answer is never mistaken for a
 * complete one (the toolkit's no-silent-downgrade invariant).
 */
export const FailureReason = {
  /** The bloom or index file could not be fetched from the gateway. */
  fetch: 'fetch',
  /** The fetched bytes did not parse (bad magic, truncated, etc.). */
  parse: 'parse',
} as const
export type FailureReason = (typeof FailureReason)[keyof typeof FailureReason]

/** A chunk that failed, with enough context to retry or report it. */
export interface ChunkFailure {
  range: BlockRange
  /** CID of the file that failed (bloom or index). */
  cid: string
  reason: FailureReason
  /** Human-readable detail (the underlying error message). */
  detail: string
}
