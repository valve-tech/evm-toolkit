import { describe, it, expect } from 'vitest'
import { bytesToBase64, base64ToBytes, encodeBlob, decodeBlob } from './blob'

describe('base64 byte helpers', () => {
  it('roundtrips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})

describe('blob wire encoding', () => {
  it('roundtrips a ciphertext+nonce pair through the wire shape', () => {
    const ciphertext = new Uint8Array([10, 20, 30])
    const nonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const wire = encodeBlob({ ciphertext, nonce })
    expect(typeof wire.ciphertext).toBe('string')
    expect(typeof wire.nonce).toBe('string')
    const back = decodeBlob(wire)
    expect(back.ciphertext).toEqual(ciphertext)
    expect(back.nonce).toEqual(nonce)
  })
})
