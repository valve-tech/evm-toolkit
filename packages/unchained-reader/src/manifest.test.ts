import { describe, it, expect } from 'vitest'

import { parseManifest, ACCEPTED_VERSION } from './manifest.js'

// A minimal but real-shaped manifest. Field names and the zero-padded
// "first-last" range string match what ipfs.valve.city actually serves
// (verified against the live pulsechain-v4 manifest, 2026-06-12).
const validRaw = {
  version: ACCEPTED_VERSION,
  chain: 'pulsechain-v4',
  specification: 'QmUyyU8wKW57c3CuwphhMdZb2QA5bsjt9vVfTE6LcBKmE9',
  config: { appsPerChunk: 2000000, snapToGrid: 250000, firstSnap: 2000000, unripeDist: 28, allowMissing: true },
  chunks: [
    {
      range: '000000001-000590510',
      bloomHash: 'Qmd1aVEJZVKAVLjbdfKxEmRhC6Ja1djS69q2jqzJGzrVP3',
      bloomSize: 131114,
      indexHash: 'QmXbDKGWtkL3j9iWKs5AUcAYh97ev2RohKqL5AYQ26pYvG',
      indexSize: 16821356,
    },
    {
      range: '002748827-002750000',
      bloomHash: 'QmSTtEVhvHT2KDNo39r3goZQGkaCu45TVp9pdwse7JerXB',
      bloomSize: 131114,
      indexHash: 'QmcYrPGCYwhh1XqwXqJtjVQkq6vj63kXagBGsdWzWwQwnh',
      indexSize: 364976,
    },
  ],
}

describe('parseManifest', () => {
  it('maps top-level fields and parses each chunk range to bigint bounds', () => {
    const m = parseManifest(validRaw)
    expect(m.chain).toBe('pulsechain-v4')
    expect(m.version).toBe(ACCEPTED_VERSION)
    expect(m.specification).toBe('QmUyyU8wKW57c3CuwphhMdZb2QA5bsjt9vVfTE6LcBKmE9')
    expect(m.chunks).toHaveLength(2)
    expect(m.chunks[0].range).toEqual({ first: 1n, last: 590510n })
    expect(m.chunks[1].range).toEqual({ first: 2748827n, last: 2750000n })
    expect(m.chunks[1].bloomHash).toBe('QmSTtEVhvHT2KDNo39r3goZQGkaCu45TVp9pdwse7JerXB')
    expect(m.chunks[1].indexSize).toBe(364976)
  })

  it('passes the config block through verbatim', () => {
    const m = parseManifest(validRaw)
    expect(m.config.appsPerChunk).toBe(2000000)
    expect(m.config.allowMissing).toBe(true)
  })

  it('rejects an unknown spec version loudly (no silent downgrade)', () => {
    const bad = { ...validRaw, version: 'trueblocks-core@v9.9.9-future' }
    expect(() => parseManifest(bad)).toThrow(/unsupported manifest version/i)
  })

  it('rejects a non-object input', () => {
    expect(() => parseManifest(null)).toThrow(/manifest/i)
    expect(() => parseManifest('nope')).toThrow(/manifest/i)
  })

  it('rejects a malformed range string', () => {
    const bad = { ...validRaw, chunks: [{ ...validRaw.chunks[0], range: 'not-a-range' }] }
    expect(() => parseManifest(bad)).toThrow(/range/i)
  })
})
