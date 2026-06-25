import { describe, it, expect } from 'vitest'
import { createBloomCache } from './bloom-cache'

const bytes = (n: number): Uint8Array => new Uint8Array([n, n, n])

describe('bloom cache — bloom-only retention', () => {
  it('retains a CID only after it is marked as a bloom', async () => {
    const bc = createBloomCache()
    // An unmarked CID (an index chunk) is dropped on put.
    await bc.cache.put('index-chunk-cid', bytes(1))
    expect(await bc.cache.get('index-chunk-cid')).toBeUndefined()
    expect(bc.has('index-chunk-cid')).toBe(false)

    // A marked CID (a bloom) is retained.
    bc.markBloom('bloom-cid')
    await bc.cache.put('bloom-cid', bytes(2))
    expect(await bc.cache.get('bloom-cid')).toEqual(bytes(2))
    expect(bc.has('bloom-cid')).toBe(true)
  })

  it('bounds size() to the marked bloom set, never the index chunks', async () => {
    const bc = createBloomCache()
    bc.markBlooms(['b1', 'b2'])
    await bc.cache.put('b1', bytes(1))
    await bc.cache.put('idx-huge', bytes(9)) // unmarked — must not grow the resident set
    await bc.cache.put('b2', bytes(2))
    expect(bc.size()).toBe(2)
  })

  it('get returns undefined for a marked-but-not-yet-fetched bloom', async () => {
    const bc = createBloomCache()
    bc.markBloom('cold')
    expect(await bc.cache.get('cold')).toBeUndefined()
    expect(bc.has('cold')).toBe(false)
  })

  it('markBlooms is additive — earlier marks survive', async () => {
    const bc = createBloomCache()
    bc.markBloom('first')
    bc.markBlooms(['second', 'third'])
    await bc.cache.put('first', bytes(1))
    await bc.cache.put('third', bytes(3))
    expect(bc.size()).toBe(2)
    expect(bc.has('first')).toBe(true)
    expect(bc.has('third')).toBe(true)
  })
})
