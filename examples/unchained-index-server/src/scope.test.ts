import { describe, it, expect } from 'vitest'
import type { Manifest, ChunkRef } from '@valve-tech/unchained-reader'
import { scopeManifest } from './scope'

const chunk = (i: number): ChunkRef => ({
  range: { first: BigInt(i * 100), last: BigInt(i * 100 + 99) },
  bloomHash: `bloom-${i}`,
  bloomSize: 1,
  indexHash: `index-${i}`,
  indexSize: 1,
})

const manifestWith = (count: number): Manifest => ({
  chain: 'test',
  specification: 'spec',
  version: 'trueblocks-core@v2.0.0-release',
  config: { appsPerChunk: 1, snapToGrid: 0, firstSnap: 0, unripeDist: 0 },
  chunks: Array.from({ length: count }, (_, i) => chunk(i)),
})

describe('scopeManifest', () => {
  it('keeps only the trailing recentChunks by default', () => {
    const scoped = scopeManifest(manifestWith(10), { full: false, recentChunks: 3 })
    expect(scoped.chunks.map((c) => c.bloomHash)).toEqual(['bloom-7', 'bloom-8', 'bloom-9'])
  })

  it('returns every chunk when full is requested', () => {
    const manifest = manifestWith(10)
    const scoped = scopeManifest(manifest, { full: true, recentChunks: 3 })
    expect(scoped.chunks).toHaveLength(10)
    expect(scoped).toBe(manifest) // unchanged reference — no slice
  })

  it('returns the manifest unchanged when it already fits in recentChunks', () => {
    const manifest = manifestWith(3)
    expect(scopeManifest(manifest, { full: false, recentChunks: 6 })).toBe(manifest)
    // boundary: exactly recentChunks is still "fits"
    const exact = manifestWith(6)
    expect(scopeManifest(exact, { full: false, recentChunks: 6 })).toBe(exact)
  })

  it('preserves manifest metadata when slicing', () => {
    const scoped = scopeManifest(manifestWith(10), { full: false, recentChunks: 2 })
    expect(scoped.chain).toBe('test')
    expect(scoped.version).toBe('trueblocks-core@v2.0.0-release')
    expect(scoped.chunks).toHaveLength(2)
  })
})
