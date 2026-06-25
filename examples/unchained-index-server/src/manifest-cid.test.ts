import { describe, it, expect } from 'vitest'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { decodeManifestCid } from './manifest-cid'

/** Ground truth: encode a string exactly as the contract view would return it. */
const encodeStringReturn = (value: string): string =>
  encodeAbiParameters(parseAbiParameters('string'), [value])

describe('decodeManifestCid', () => {
  it('decodes a v0 (Qm…) CID round-tripped through ABI string encoding', () => {
    const cid = 'QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx'
    expect(decodeManifestCid(encodeStringReturn(cid))).toBe(cid)
  })

  it('decodes a v1 (bafy…) CID — length not a multiple of 32', () => {
    const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    expect(decodeManifestCid(encodeStringReturn(cid))).toBe(cid)
  })

  it('returns "" for an empty contract result (no manifest published)', () => {
    expect(decodeManifestCid('0x')).toBe('')
    expect(decodeManifestCid('')).toBe('')
  })

  it('tolerates a result with no 0x prefix', () => {
    const cid = 'QmTest'
    const encoded = encodeStringReturn(cid)
    expect(decodeManifestCid(encoded.slice(2))).toBe(cid)
  })
})
