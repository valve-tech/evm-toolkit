import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

import { parseChunkHeader, appearancesOf } from './chunk.js'
import type { Appearance } from './types.js'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)))

// A 40-address contiguous slice of the real pulsechain-v4 index chunk
// 002748827-002750000 (addresses stay sorted; offsets renumbered).
const slice = fixture('index-943-002748827-002750000-slice.bin')
const genesis = fixture('index-943-genesis.bin')

const app = (b: bigint, t: bigint): Appearance => ({ blockNumber: b, transactionIndex: t })

describe('parseChunkHeader', () => {
  it('reads magic + record counts from a real index chunk', () => {
    const h = parseChunkHeader(slice)
    expect(h.addressCount).toBe(40)
    expect(h.appearanceCount).toBe(92)
  })

  it('reads 0/0 from the genesis (empty) chunk', () => {
    const h = parseChunkHeader(genesis)
    expect(h.addressCount).toBe(0)
    expect(h.appearanceCount).toBe(0)
  })

  it('rejects a file with the wrong magic number', () => {
    const corrupt = slice.slice()
    corrupt[0] = 0
    expect(() => parseChunkHeader(corrupt)).toThrow(/magic/i)
  })
})

describe('appearancesOf', () => {
  it('returns the exact appearances for a known address (on-chain verified)', () => {
    // 0x0000908102040217905550828260010160026101 was confirmed against the
    // live 943 chain: both appearances are real txs (address in calldata).
    const got = appearancesOf(slice, '0x0000908102040217905550828260010160026101')
    expect(got).toEqual([app(2749518n, 1n), app(2749585n, 4n)])
  })

  it('decodes a multi-appearance address end to end (13 appearances)', () => {
    const got = appearancesOf(slice, '0x001a589dda0d6be37632925eaf1256986b2c6ad0')
    expect(got).toHaveLength(13)
    expect(got[0]).toEqual(app(2748922n, 0n))
    expect(got[12]).toEqual(app(2749613n, 5n))
  })

  it('finds the first address in the (sorted) table', () => {
    const got = appearancesOf(slice, '0x0000000000000000ffffffffffffffffffffd8e4')
    expect(got).toEqual([app(2749407n, 2n)])
  })

  it('returns [] for an address not present in the chunk', () => {
    expect(appearancesOf(slice, '0x1234567890abcdef1234567890abcdef12345678')).toEqual([])
  })

  it('returns [] against an empty chunk', () => {
    expect(appearancesOf(genesis, '0x0000908102040217905550828260010160026101')).toEqual([])
  })

  it('rejects a malformed address', () => {
    expect(() => appearancesOf(slice, 'nope')).toThrow(/address/i)
  })
})
