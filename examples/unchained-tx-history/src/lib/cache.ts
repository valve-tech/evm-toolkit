/**
 * A `ChunkCache` backed by the browser Cache API. Chunks and blooms are
 * content-addressed (CID), so a cached entry is always valid — re-querying
 * an address never refetches a bloom or chunk it has already seen.
 *
 * Degrades to a no-op cache where the Cache API is unavailable (e.g.
 * non-secure contexts), so the app still works, just without persistence.
 */
import type { ChunkCache } from '@valve-tech/unchained-reader'

const CACHE_NAME = 'unchained-chunks-v1'
// Synthetic origin for cache keys — the CID is the only thing that matters.
const keyUrl = (cid: string): string => `https://chunk.cache/${cid}`

export const createBrowserCache = (): ChunkCache => {
  const available = typeof caches !== 'undefined'
  return {
    async get(cid) {
      if (!available) return undefined
      const cache = await caches.open(CACHE_NAME)
      const hit = await cache.match(keyUrl(cid))
      if (!hit) return undefined
      return new Uint8Array(await hit.arrayBuffer())
    },
    async put(cid, bytes) {
      if (!available) return
      const cache = await caches.open(CACHE_NAME)
      // Copy into a fresh ArrayBuffer so the Response owns its bytes.
      const body = bytes.slice()
      await cache.put(keyUrl(cid), new Response(body))
    },
  }
}
