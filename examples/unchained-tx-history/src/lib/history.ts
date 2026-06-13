/**
 * Direct (trustless) query path: resolve the manifest live from chain,
 * bound the scope to recent chunks (unless the user asked for everything),
 * and stream the address's appearances + failures straight from
 * `@valve-tech/unchained-reader` in the browser.
 *
 * Implements the shared {@link StreamQuery} contract so the App can swap in
 * the backend-accelerated path ({@link ./backend}) without changing its
 * render/hydrate logic.
 */
import {
  createFetcher,
  createUnchainedReader,
  parseManifest,
  type Manifest,
  type Progress,
  type Appearance,
} from '@valve-tech/unchained-reader'

import { IPFS_GATEWAY, DEFAULT_RECENT_CHUNKS, type ChainConfig } from '../config'
import { createBrowserCache } from './cache'
import { resolveManifestCid } from './rpc'

const fetcher = createFetcher({
  gatewayUrl: IPFS_GATEWAY,
  cache: createBrowserCache(),
  concurrency: 6,
  // Some mainnet chunks aren't pinned on this gateway; without a timeout
  // an unavailable CID hangs the whole query on a DHT lookup. Bound it so
  // the unavailable chunks surface as failures and the rest still render.
  // No retry: a timed-out CID is almost always unpinned, so retrying just
  // doubles the wait for the same failure.
  timeoutMs: 15_000,
  maxRetries: 0,
})

/** Fetch + parse the manifest JSON for a CID from the gateway. */
const loadManifest = async (cid: string): Promise<Manifest> => {
  const res = await fetch(`${IPFS_GATEWAY}/ipfs/${cid}`)
  if (!res.ok) throw new Error(`manifest fetch: HTTP ${res.status}`)
  return parseManifest(await res.json())
}

export interface QueryScope {
  /** When true, search the whole index; otherwise just recent chunks. */
  fullHistory: boolean
}

/** The block window actually scanned (first..last of the in-scope chunks). */
export interface Scanned {
  first: bigint
  last: bigint
  chunks: number
}

/** A chunk that couldn't be read — surfaced so partial results read as partial. */
export interface QueryFailure {
  first: bigint
  last: bigint
  cid: string
  reason: string
}

export interface QueryOutcome {
  scanned: Scanned | null
  failures: QueryFailure[]
}

/** Streaming callbacks shared by the direct and backend query paths. */
export interface StreamHandlers {
  onProgress: (p: Progress) => void
  onAppearances: (found: Appearance[]) => void
  /** Backend only: one-time bloom-load progress while a cold chain warms. */
  onStatus?: (s: { loadingDone: number; loadingTotal: number }) => void
  /** Backend only: bytes received over the SSE stream (client-side wire). */
  onWire?: (bytes: number) => void
}

/** The contract both query sources implement. */
export type StreamQuery = (
  chain: ChainConfig,
  address: string,
  scope: QueryScope,
  handlers: StreamHandlers,
  signal: AbortSignal,
) => Promise<QueryOutcome>

export const queryHistory: StreamQuery = async (chain, address, scope, handlers, signal) => {
  const cid = await resolveManifestCid(chain.chainKey)
  const full = await loadManifest(cid)

  // Bound to the most recent chunks unless full history is requested.
  const manifest: Manifest =
    scope.fullHistory || full.chunks.length <= DEFAULT_RECENT_CHUNKS
      ? full
      : { ...full, chunks: full.chunks.slice(-DEFAULT_RECENT_CHUNKS) }

  const reader = createUnchainedReader({ fetcher, manifest })
  const result = await reader.getAppearances(address, {
    onProgress: handlers.onProgress,
    onAppearances: handlers.onAppearances,
    signal,
  })

  const cs = manifest.chunks
  return {
    scanned: cs.length
      ? { first: cs[0].range.first, last: cs[cs.length - 1].range.last, chunks: cs.length }
      : null,
    failures: result.failures.map((f) => ({
      first: f.range.first,
      last: f.range.last,
      cid: f.cid,
      reason: f.reason,
    })),
  }
}
