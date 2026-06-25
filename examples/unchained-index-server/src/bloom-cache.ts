/**
 * The in-memory bloom store — the one invariant the whole server rests on.
 *
 * The fetcher caches every CID it pulls via this `ChunkCache`, but `put`
 * retains ONLY CIDs that were first marked as blooms (from the manifest).
 * Index chunks (tens of MB each) are pulled, parsed, and dropped — so the
 * resident set is bounded to the bloom set and never the index chunks.
 * `get` is what turns a warm query into an in-RAM scan: no network for
 * blooms already seen.
 */
import type { ChunkCache } from '@valve-tech/unchained-reader'

export interface BloomCache {
  /** Hand this to the fetcher. `put` stores ONLY marked bloom CIDs. */
  readonly cache: ChunkCache
  /** Mark a CID as a bloom so a later `put` for it is retained. */
  markBloom(cid: string): void
  /** Mark many bloom CIDs at once (e.g. a whole manifest's worth). */
  markBlooms(cids: Iterable<string>): void
  /** Whether a bloom is resident in memory (drives the `warm` meta flag). */
  has(cid: string): boolean
  /** Count of resident blooms (drives `/health`). */
  size(): number
}

export const createBloomCache = (): BloomCache => {
  const blooms = new Map<string, Uint8Array>()
  const bloomCids = new Set<string>()
  return {
    cache: {
      get: (cid) => Promise.resolve(blooms.get(cid)),
      put: (cid, bytes) => {
        if (bloomCids.has(cid)) blooms.set(cid, bytes)
        return Promise.resolve()
      },
    },
    markBloom: (cid) => {
      bloomCids.add(cid)
    },
    markBlooms: (cids) => {
      for (const cid of cids) bloomCids.add(cid)
    },
    has: (cid) => blooms.has(cid),
    size: () => blooms.size,
  }
}
