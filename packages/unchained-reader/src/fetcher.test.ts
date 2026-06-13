import { describe, it, expect, vi } from 'vitest'

import { createFetcher } from './fetcher.js'
import type { FetchLike, ChunkCache } from './fetcher.js'

const bytes = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => i & 0xff)

const okFetch =
  (body: Uint8Array): FetchLike =>
  async () => ({ ok: true, status: 200, arrayBuffer: async () => body.buffer })

const memoryCache = (): ChunkCache & { store: Map<string, Uint8Array> } => {
  const store = new Map<string, Uint8Array>()
  return {
    store,
    get: async (cid) => store.get(cid),
    put: async (cid, b) => void store.set(cid, b),
  }
}

describe('createFetcher', () => {
  it('fetches a CID from the gateway and returns its bytes', async () => {
    const body = bytes(10)
    const fetch = vi.fn(okFetch(body))
    const f = createFetcher({ gatewayUrl: 'https://ipfs.example', fetch })
    const got = await f.fetchCid('QmABC')
    expect(Array.from(got)).toEqual(Array.from(body))
    expect(fetch.mock.calls[0][0]).toBe('https://ipfs.example/ipfs/QmABC')
  })

  it('normalizes a trailing slash on the gateway URL', async () => {
    const fetch = vi.fn(okFetch(bytes(1)))
    const f = createFetcher({ gatewayUrl: 'https://ipfs.example/', fetch })
    await f.fetchCid('QmABC')
    expect(fetch.mock.calls[0][0]).toBe('https://ipfs.example/ipfs/QmABC')
  })

  it('serves from cache without hitting the network on a hit', async () => {
    const cache = memoryCache()
    cache.store.set('QmHit', bytes(5))
    const fetch = vi.fn(okFetch(bytes(99)))
    const f = createFetcher({ gatewayUrl: 'https://ipfs.example', fetch, cache })
    const got = await f.fetchCid('QmHit')
    expect(Array.from(got)).toEqual(Array.from(bytes(5)))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('populates the cache on a miss', async () => {
    const cache = memoryCache()
    const body = bytes(7)
    const f = createFetcher({ gatewayUrl: 'https://ipfs.example', fetch: okFetch(body), cache })
    await f.fetchCid('QmMiss')
    expect(cache.store.has('QmMiss')).toBe(true)
  })

  it('retries once on failure, then succeeds', async () => {
    let calls = 0
    const fetch: FetchLike = async () => {
      calls += 1
      if (calls === 1) throw new Error('network blip')
      return { ok: true, status: 200, arrayBuffer: async () => bytes(3).buffer }
    }
    const f = createFetcher({ gatewayUrl: 'https://ipfs.example', fetch, maxRetries: 1 })
    const got = await f.fetchCid('QmRetry')
    expect(got.length).toBe(3)
    expect(calls).toBe(2)
  })

  it('throws after retries are exhausted', async () => {
    const fetch: FetchLike = async () => {
      throw new Error('always down')
    }
    const f = createFetcher({ gatewayUrl: 'https://ipfs.example', fetch, maxRetries: 1 })
    await expect(f.fetchCid('QmDead')).rejects.toThrow(/always down/)
  })

  it('treats a non-ok HTTP status as a failure', async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 504, arrayBuffer: async () => new ArrayBuffer(0) })
    const f = createFetcher({ gatewayUrl: 'https://ipfs.example', fetch, maxRetries: 0 })
    await expect(f.fetchCid('QmGateway')).rejects.toThrow(/504/)
  })

  it('times out a hanging fetch and rejects (never stalls forever)', async () => {
    // A gateway that accepts the request but never responds — exactly what
    // an unpinned CID does (the gateway hangs on a DHT lookup). The fetch
    // must abort on the timeout, not hang the whole query.
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted by timeout')),
        )
      })
    const f = createFetcher({
      gatewayUrl: 'https://ipfs.example',
      fetch,
      timeoutMs: 100,
      maxRetries: 0,
    })
    await expect(f.fetchCid('QmHang')).rejects.toThrow(/timed out|aborted/i)
  })

  it('passes an abort signal to the underlying fetch', async () => {
    let sawSignal = false
    const fetch: FetchLike = async (_url, init) => {
      sawSignal = init?.signal instanceof AbortSignal
      return { ok: true, status: 200, arrayBuffer: async () => bytes(1).buffer }
    }
    const f = createFetcher({ gatewayUrl: 'https://ipfs.example', fetch })
    await f.fetchCid('QmABC')
    expect(sawSignal).toBe(true)
  })

  it('never exceeds the concurrency cap of in-flight fetches', async () => {
    let inFlight = 0
    let peak = 0
    const fetch: FetchLike = async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      return { ok: true, status: 200, arrayBuffer: async () => bytes(1).buffer }
    }
    const f = createFetcher({ gatewayUrl: 'https://ipfs.example', fetch, concurrency: 3 })
    await Promise.all(Array.from({ length: 12 }, (_, i) => f.fetchCid(`Qm${i}`)))
    expect(peak).toBeLessThanOrEqual(3)
  })
})
