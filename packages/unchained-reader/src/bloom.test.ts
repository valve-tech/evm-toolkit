import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

import { parseBloom, mightContain } from './bloom.js'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)))

// Real published bloom for pulsechain-v4 chunk 002748827-002750000 (1 bloom).
const realBloom = fixture('bloom-943-002748827-002750000.bin')
// Genesis chunk's bloom: header + count=0, no bloom bodies.
const emptyBloom = fixture('bloom-943-genesis.bin')

// Ground truth established against the real fixture + the live 943 chain
// (2026-06-12): these two addresses appear in the chunk's index...
const MEMBER_A = '0x0000000000000000ffffffffffffffffffffd6c8' // first addr in chunk
const MEMBER_B = '0x0000908102040217905550828260010160026101' // appears in tx calldata
// ...and this random address does not (no false negatives; FP rate is low).
const ABSENT = '0x1234567890abcdef1234567890abcdef12345678'

describe('parseBloom', () => {
  it('reads the header magic + bloom count from a real bloom', () => {
    const b = parseBloom(realBloom)
    expect(b.count).toBe(1)
  })

  it('reads count=0 from the genesis (empty) bloom', () => {
    expect(parseBloom(emptyBloom).count).toBe(0)
  })

  it('rejects a file with the wrong magic number', () => {
    const corrupt = realBloom.slice()
    corrupt[0] = 0x00
    corrupt[1] = 0x00
    expect(() => parseBloom(corrupt)).toThrow(/magic/i)
  })
})

describe('mightContain', () => {
  it('returns true for addresses known to be in the chunk', () => {
    const b = parseBloom(realBloom)
    expect(mightContain(b, MEMBER_A)).toBe(true)
    expect(mightContain(b, MEMBER_B)).toBe(true)
  })

  it('returns false for an address not in the chunk', () => {
    expect(mightContain(parseBloom(realBloom), ABSENT)).toBe(false)
  })

  it('is case- and prefix-insensitive on the address input', () => {
    const b = parseBloom(realBloom)
    expect(mightContain(b, MEMBER_A.toUpperCase().replace('0X', '0x'))).toBe(true)
    expect(mightContain(b, MEMBER_A.slice(2))).toBe(true)
  })

  it('always returns false against an empty bloom', () => {
    const b = parseBloom(emptyBloom)
    expect(mightContain(b, MEMBER_A)).toBe(false)
  })

  it('rejects a malformed address', () => {
    const b = parseBloom(realBloom)
    expect(() => mightContain(b, '0xabc')).toThrow(/address/i)
  })
})
