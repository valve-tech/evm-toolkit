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

/** The init bag passed to `fetch` — only the abort signal is used. */
export interface FetchInit {
  signal?: AbortSignal
}

/** Minimal subset of the platform `fetch` — what callers must provide. */
export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>

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
  /** Max concurrent NORMAL (bloom) gateway requests. Default 6. */
  concurrency?: number
  /**
   * Max concurrent PRIORITY (index-chunk) requests, in a SEPARATE pool from
   * `concurrency`. Index chunks are large (tens of MB); giving them their
   * own lane means a burst of bloom hits downloads chunks promptly without
   * stalling the ongoing bloom scan (and vice versa). Default 4.
   */
  priorityConcurrency?: number
  /** Extra attempts after the first failure. Default 1 (one retry). */
  maxRetries?: number
  /**
   * Per-request timeout in ms. A gateway that accepts the request but
   * never responds (e.g. an unpinned CID it tries to resolve over the
   * DHT) would otherwise hang the whole query forever. On timeout the
   * request is aborted and treated as a failure. Default 20000.
   */
  timeoutMs?: number
}

/** Options for a single {@link Fetcher.fetchCid} call. */
export interface FetchCidOptions {
  /**
   * Use the separate priority pool (`priorityConcurrency`) instead of the
   * normal one. Index-chunk fetches set this so a bloom *hit* downloads its
   * chunk in a reserved lane — promptly, and without stalling the ongoing
   * bloom scan that shares no slots with it.
   */
  priority?: boolean
}

export interface Fetcher {
  /** Fetch a CID's bytes (cache-first), retrying + queueing as configured. */
  fetchCid(cid: string, opts?: FetchCidOptions): Promise<Uint8Array>
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
  const timeoutMs = config.timeoutMs ?? 20_000
  // Two independent pools so big index-chunk downloads never starve the
  // ongoing bloom scan (and vice versa).
  const bloomLimit = createLimiter(config.concurrency ?? 6)
  const indexLimit = createLimiter(config.priorityConcurrency ?? 4)
  const { cache } = config

  const fetchOnce = async (cid: string): Promise<Uint8Array> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(`${base}/ipfs/${cid}`, { signal: controller.signal })
      if (!res.ok) {
        throw new Error(`unchained-reader: gateway returned HTTP ${res.status} for ${cid}`)
      }
      return new Uint8Array(await res.arrayBuffer())
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`unchained-reader: fetch for ${cid} timed out after ${timeoutMs}ms`)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
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

  const fetchCid = async (cid: string, opts?: FetchCidOptions): Promise<Uint8Array> => {
    if (cache) {
      const hit = await cache.get(cid)
      if (hit) return hit
    }
    const limiter = opts?.priority ? indexLimit : bloomLimit
    const bytes = await limiter(() => fetchWithRetry(cid))
    if (cache) await cache.put(cid, bytes)
    return bytes
  }

  return { fetchCid }
}
