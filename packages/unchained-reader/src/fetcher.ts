/**
 * IPFS gateway fetch layer for the Unchained Index reader.
 *
 * The only I/O in the package. Everything else parses bytes. Kept
 * browser/edge/RN-safe: no Node `http`, no global `fetch` type
 * dependency (a minimal `FetchLike` is defined here so the package needs
 * neither the DOM lib nor `@types/node`'s fetch). The example wires the
 * platform `fetch` and a browser Cache-API-backed `ChunkCache`.
 *
 * Responsibilities: build the gateway URL, retry transient failures a
 * bounded number of times, cap concurrent in-flight requests, and consult
 * an injectable content cache (chunks are content-addressed, so a cache
 * hit is always valid — no invalidation needed).
 */

/** Minimal subset of the platform `Response` this package consumes. */
export interface FetchResponse {
  ok: boolean
  status: number
  arrayBuffer(): Promise<ArrayBuffer>
}

/** Minimal subset of the platform `fetch` — what callers must provide. */
export type FetchLike = (url: string) => Promise<FetchResponse>

/**
 * Content cache keyed by CID. Both methods are async so consumers can
 * back it with the browser Cache API, IndexedDB, or disk. CIDs are
 * immutable content addresses, so entries never go stale.
 */
export interface ChunkCache {
  get(cid: string): Promise<Uint8Array | undefined>
  put(cid: string, bytes: Uint8Array): Promise<void>
}

export interface FetcherConfig {
  /** Gateway base, e.g. `https://ipfs.valve.city`. A trailing `/` is fine. */
  gatewayUrl: string
  /** Platform fetch. Defaults to `globalThis.fetch` when present. */
  fetch?: FetchLike
  /** Optional content cache. */
  cache?: ChunkCache
  /** Max concurrent in-flight gateway requests. Default 6. */
  concurrency?: number
  /** Extra attempts after the first failure. Default 1 (one retry). */
  maxRetries?: number
}

export interface Fetcher {
  /** Fetch a CID's bytes (cache-first), retrying + queueing as configured. */
  fetchCid(cid: string): Promise<Uint8Array>
}

const resolveFetch = (injected?: FetchLike): FetchLike => {
  if (injected) return injected
  const g = (globalThis as { fetch?: FetchLike }).fetch
  if (!g) {
    throw new Error('unchained-reader: no fetch available — pass config.fetch')
  }
  return g
}

/** A tiny FIFO semaphore so at most `limit` tasks run concurrently. */
const createLimiter = (limit: number): (<T>(task: () => Promise<T>) => Promise<T>) => {
  let active = 0
  const queue: Array<() => void> = []
  const next = (): void => {
    active -= 1
    const run = queue.shift()
    if (run) run()
  }
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = (): void => {
        active += 1
        task().then(resolve, reject).finally(next)
      }
      if (active < limit) start()
      else queue.push(start)
    })
}

export const createFetcher = (config: FetcherConfig): Fetcher => {
  const fetchImpl = resolveFetch(config.fetch)
  const base = config.gatewayUrl.replace(/\/+$/, '')
  const maxRetries = config.maxRetries ?? 1
  const limit = createLimiter(config.concurrency ?? 6)
  const { cache } = config

  const fetchOnce = async (cid: string): Promise<Uint8Array> => {
    const res = await fetchImpl(`${base}/ipfs/${cid}`)
    if (!res.ok) {
      throw new Error(`unchained-reader: gateway returned HTTP ${res.status} for ${cid}`)
    }
    return new Uint8Array(await res.arrayBuffer())
  }

  const fetchWithRetry = async (cid: string): Promise<Uint8Array> => {
    let lastErr: unknown
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await fetchOnce(cid)
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  const fetchCid = async (cid: string): Promise<Uint8Array> => {
    if (cache) {
      const hit = await cache.get(cid)
      if (hit) return hit
    }
    const bytes = await limit(() => fetchWithRetry(cid))
    if (cache) await cache.put(cid, bytes)
    return bytes
  }

  return { fetchCid }
}
