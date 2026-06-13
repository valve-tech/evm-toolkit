/**
 * Glue between the UI and `@valve-tech/unchained-reader`: resolve the
 * manifest live from chain, bound the scope to recent chunks (unless the
 * user asked for everything), and return the address's appearances with
 * progress + failures surfaced.
 */
import {
  createFetcher,
  createUnchainedReader,
  parseManifest,
  type Manifest,
  type Progress,
  type AppearancesResult,
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

export interface QueryHandle {
  manifest: Manifest
  result: AppearancesResult
}

/**
 * Run a full lookup for an address on a chain. `onProgress` fires
 * throughout; `signal` cancels.
 */
export const queryHistory = async (
  chain: ChainConfig,
  address: string,
  scope: QueryScope,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<QueryHandle> => {
  const cid = await resolveManifestCid(chain.chainKey)
  const full = await loadManifest(cid)

  // Bound to the most recent chunks unless full history is requested.
  const manifest: Manifest =
    scope.fullHistory || full.chunks.length <= DEFAULT_RECENT_CHUNKS
      ? full
      : { ...full, chunks: full.chunks.slice(-DEFAULT_RECENT_CHUNKS) }

  const reader = createUnchainedReader({ fetcher, manifest })
  const result = await reader.getAppearances(address, { onProgress, signal })
  return { manifest, result }
}
