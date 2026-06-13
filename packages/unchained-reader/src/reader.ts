/**
 * Orchestrator: manifest → blooms → chunks → appearances.
 *
 * `createUnchainedReader(config).getAppearances(address, opts)` resolves
 * the manifest, filters chunks to the requested block range, fetches each
 * chunk's bloom (concurrently — the fetcher caps concurrency), and only
 * when a bloom matches does it fetch + parse the index for the address's
 * appearances.
 *
 * Two invariants from the toolkit, both load-bearing here:
 *  - Progress is first-class: `opts.onProgress` fires with running counts
 *    so a UI can render a long multi-fetch operation.
 *  - No silent downgrade: anything that fails to fetch or parse lands in
 *    `result.failures` with its range, CID, and reason. A partial answer
 *    is never returned looking complete.
 */
import { parseManifest } from './manifest.js'
import { parseBloom, mightContain } from './bloom.js'
import { appearancesOf } from './chunk.js'
import { normalizeAddress, type HexAddress } from './address.js'
import { FailureReason } from './types.js'
import type { Fetcher } from './fetcher.js'
import type { Manifest, ChunkRef, BlockRange, Appearance, ChunkFailure } from './types.js'

/** Progress snapshot passed to `onProgress` and returned in the result. */
export interface Progress {
  /** Chunks in scope after block-range filtering. */
  chunksTotal: number
  /** Bloom files fetched + parsed so far. */
  bloomsFetched: number
  /** Blooms that reported a possible match (index fetch warranted). */
  hits: number
  /** Index chunks fetched + parsed so far. */
  chunksFetched: number
  /** Appearances accumulated so far. */
  appearancesFound: number
  /** Total bytes pulled from the gateway so far (blooms + index chunks). */
  bytesFetched: number
}

export interface GetAppearancesOptions {
  /** Restrict to appearances within this inclusive block range. */
  blockRange?: BlockRange
  /** Called after each bloom/chunk step with a fresh progress snapshot. */
  onProgress?: (progress: Progress) => void
  /**
   * Streaming sink: fires the moment a chunk's index is parsed and yields
   * one or more appearances, BEFORE the whole query finishes. Lets a UI
   * render (and hydrate) results as they arrive instead of waiting for the
   * full scan. Chunks resolve concurrently, so calls arrive out of block
   * order — sort on the consumer side. The final `AppearancesResult`
   * still carries the complete, sorted set.
   */
  onAppearances?: (found: Appearance[], chunk: ChunkRef) => void
  /** Abort an in-flight query. */
  signal?: AbortSignal
}

export interface AppearancesResult {
  address: HexAddress
  /** Ascending by (blockNumber, transactionIndex). */
  appearances: Appearance[]
  /** Chunks that could not be fetched or parsed. Empty = fully complete. */
  failures: ChunkFailure[]
  progress: Progress
}

/**
 * Manifest resolution — provide exactly one. `manifest` (pre-parsed) and
 * `manifestCid` (fetched via the gateway fetcher) are native. URL-served
 * manifests and the contract-publication resolver are supplied via
 * `resolveManifest` so the zero-dep core never grows a second fetch path
 * or a viem dependency (the example wires the contract `eth_call` there).
 */
export interface ReaderConfig {
  fetcher: Fetcher
  manifest?: Manifest
  manifestCid?: string
  resolveManifest?: () => Promise<unknown>
}

export interface UnchainedReader {
  getAppearances(address: string, opts?: GetAppearancesOptions): Promise<AppearancesResult>
}

const rangesOverlap = (a: BlockRange, b: BlockRange): boolean =>
  a.first <= b.last && b.first <= a.last

const inRange = (app: Appearance, range: BlockRange): boolean =>
  app.blockNumber >= range.first && app.blockNumber <= range.last

const compareAppearances = (a: Appearance, b: Appearance): number => {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1
  if (a.transactionIndex !== b.transactionIndex) return a.transactionIndex < b.transactionIndex ? -1 : 1
  return 0
}

const decodeJson = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(bytes))

export const createUnchainedReader = (config: ReaderConfig): UnchainedReader => {
  const resolveManifest = async (): Promise<Manifest> => {
    if (config.manifest) return config.manifest
    if (config.manifestCid) {
      return parseManifest(decodeJson(await config.fetcher.fetchCid(config.manifestCid)))
    }
    if (config.resolveManifest) {
      return parseManifest(await config.resolveManifest())
    }
    throw new Error('unchained-reader: provide manifest, manifestCid, or resolveManifest')
  }

  const getAppearances = async (
    address: string,
    opts: GetAppearancesOptions = {},
  ): Promise<AppearancesResult> => {
    const normalized = normalizeAddress(address)
    const manifest = await resolveManifest()

    const chunks = opts.blockRange
      ? manifest.chunks.filter((c) => rangesOverlap(c.range, opts.blockRange as BlockRange))
      : manifest.chunks

    const progress: Progress = {
      chunksTotal: chunks.length,
      bloomsFetched: 0,
      hits: 0,
      chunksFetched: 0,
      appearancesFound: 0,
      bytesFetched: 0,
    }
    const report = (): void => opts.onProgress?.({ ...progress })

    const appearances: Appearance[] = []
    const failures: ChunkFailure[] = []

    const aborted = (): boolean => opts.signal?.aborted ?? false

    const processChunk = async (chunk: ChunkRef): Promise<void> => {
      if (aborted()) return
      let bloom
      try {
        const bloomBytes = await config.fetcher.fetchCid(chunk.bloomHash)
        bloom = parseBloom(bloomBytes)
        progress.bloomsFetched += 1
        progress.bytesFetched += bloomBytes.length
        report()
      } catch (err) {
        failures.push(failure(chunk, chunk.bloomHash, err))
        return
      }

      if (!mightContain(bloom, normalized)) return
      progress.hits += 1
      report()

      if (aborted()) return
      try {
        // Priority: a bloom hit downloads its index chunk NOW, jumping the
        // queue ahead of the remaining bloom fetches, so appearances stream
        // as they're found instead of after the whole bloom scan drains.
        const indexBytes = await config.fetcher.fetchCid(chunk.indexHash, { priority: true })
        progress.bytesFetched += indexBytes.length
        const found = appearancesOf(indexBytes, normalized)
        progress.chunksFetched += 1
        const kept = opts.blockRange
          ? found.filter((a) => inRange(a, opts.blockRange as BlockRange))
          : found
        appearances.push(...kept)
        progress.appearancesFound += kept.length
        if (kept.length > 0) opts.onAppearances?.(kept, chunk)
        report()
      } catch (err) {
        failures.push(failure(chunk, chunk.indexHash, err))
      }
    }

    await Promise.all(chunks.map(processChunk))
    appearances.sort(compareAppearances)

    return { address: normalized, appearances, failures, progress }
  }

  return { getAppearances }
}

/** Classify an error into a ChunkFailure. A parse error mentions "magic"/"short". */
const failure = (chunk: ChunkRef, cid: string, err: unknown): ChunkFailure => {
  const detail = err instanceof Error ? err.message : String(err)
  const reason = /magic|too short|parse|range/i.test(detail)
    ? FailureReason.parse
    : FailureReason.fetch
  return { range: chunk.range, cid, reason, detail }
}
