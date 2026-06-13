import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'

import { createUnchainedReader } from './reader.js'
import type { Fetcher } from './fetcher.js'
import type { Manifest } from './types.js'
import { ACCEPTED_VERSION } from './manifest.js'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)))

const realBloom = fixture('bloom-943-002748827-002750000.bin')
const sliceIndex = fixture('index-943-002748827-002750000-slice.bin')
const emptyBloom = fixture('bloom-943-genesis.bin')

// Address confirmed on-chain (943): appears in the slice chunk at
// (2749518,1) and (2749585,4).
const TARGET = '0x0000908102040217905550828260010160026101'

// CIDs are arbitrary keys here; the fake fetcher maps them to fixture bytes.
const CID = {
  bloomHit: 'bloom-hit',
  indexHit: 'index-hit',
  bloomMiss: 'bloom-miss',
  indexMiss: 'index-miss',
}

const manifest: Manifest = {
  chain: 'pulsechain-v4',
  specification: 'spec',
  version: ACCEPTED_VERSION,
  config: { appsPerChunk: 2000000, snapToGrid: 250000, firstSnap: 2000000, unripeDist: 28 },
  chunks: [
    { range: { first: 2748827n, last: 2750000n }, bloomHash: CID.bloomHit, bloomSize: realBloom.length, indexHash: CID.indexHit, indexSize: sliceIndex.length },
    { range: { first: 9000000n, last: 9100000n }, bloomHash: CID.bloomMiss, bloomSize: emptyBloom.length, indexHash: CID.indexMiss, indexSize: 44 },
  ],
}

const fakeFetcher = (map: Record<string, Uint8Array>): Fetcher & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    fetchCid: async (cid: string) => {
      calls.push(cid)
      const b = map[cid]
      if (!b) throw new Error(`no fixture for ${cid}`)
      return b
    },
  }
}

const fullMap = {
  [CID.bloomHit]: realBloom,
  [CID.indexHit]: sliceIndex,
  [CID.bloomMiss]: emptyBloom,
  [CID.indexMiss]: fixture('index-943-genesis.bin'),
}

describe('createUnchainedReader.getAppearances', () => {
  it('returns appearances from the chunk whose bloom matches', async () => {
    const fetcher = fakeFetcher(fullMap)
    const reader = createUnchainedReader({ fetcher, manifest })
    const res = await reader.getAppearances(TARGET)
    expect(res.appearances).toEqual([
      { blockNumber: 2749518n, transactionIndex: 1n },
      { blockNumber: 2749585n, transactionIndex: 4n },
    ])
    expect(res.failures).toEqual([])
  })

  it('skips the index fetch for a chunk whose bloom says "no"', async () => {
    const fetcher = fakeFetcher(fullMap)
    const reader = createUnchainedReader({ fetcher, manifest })
    await reader.getAppearances(TARGET)
    // bloomMiss is fetched (to test), but its index must never be.
    expect(fetcher.calls).toContain(CID.bloomMiss)
    expect(fetcher.calls).not.toContain(CID.indexMiss)
  })

  it('reports progress with first-class counts', async () => {
    const fetcher = fakeFetcher(fullMap)
    const reader = createUnchainedReader({ fetcher, manifest })
    const onProgress = vi.fn()
    const res = await reader.getAppearances(TARGET, { onProgress })
    expect(res.progress.chunksTotal).toBe(2)
    expect(res.progress.bloomsFetched).toBe(2)
    expect(res.progress.hits).toBe(1)
    expect(res.progress.chunksFetched).toBe(1)
    expect(res.progress.appearancesFound).toBe(2)
    expect(onProgress).toHaveBeenCalled()
  })

  it('records a failure (never throws) when a fetch fails, keeping good results', async () => {
    // Drop the index of the matching chunk so its fetch fails.
    const broken = { ...fullMap }
    delete (broken as Record<string, Uint8Array>)[CID.indexHit]
    const reader = createUnchainedReader({ fetcher: fakeFetcher(broken), manifest })
    const res = await reader.getAppearances(TARGET)
    expect(res.appearances).toEqual([])
    expect(res.failures).toHaveLength(1)
    expect(res.failures[0].cid).toBe(CID.indexHit)
    expect(res.failures[0].reason).toBe('fetch')
  })

  it('filters chunks and trims appearances to an explicit block range', async () => {
    const fetcher = fakeFetcher(fullMap)
    const reader = createUnchainedReader({ fetcher, manifest })
    // Range covers only the second appearance (2749585) of the target.
    const res = await reader.getAppearances(TARGET, { blockRange: { first: 2749550n, last: 2749600n } })
    expect(res.appearances).toEqual([{ blockNumber: 2749585n, transactionIndex: 4n }])
  })

  it('resolves the manifest from a CID when not given one inline', async () => {
    const manifestBytes = new TextEncoder().encode(
      JSON.stringify({
        version: ACCEPTED_VERSION,
        chain: 'pulsechain-v4',
        specification: 'spec',
        config: { appsPerChunk: 1, snapToGrid: 1, firstSnap: 1, unripeDist: 1 },
        chunks: [{ range: '002748827-002750000', bloomHash: CID.bloomHit, bloomSize: realBloom.length, indexHash: CID.indexHit, indexSize: sliceIndex.length }],
      }),
    )
    const fetcher = fakeFetcher({ ...fullMap, 'manifest-cid': manifestBytes })
    const reader = createUnchainedReader({ fetcher, manifestCid: 'manifest-cid' })
    const res = await reader.getAppearances(TARGET)
    expect(res.appearances).toHaveLength(2)
  })
})
