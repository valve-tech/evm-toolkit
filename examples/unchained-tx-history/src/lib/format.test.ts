import { describe, it, expect } from 'vitest'

import { shortHash, shortAddr, formatValue, isAddressLike } from './format'

describe('format helpers', () => {
  it('shortens hashes and addresses', () => {
    expect(shortAddr('0x002c67e5f1d6eec758e1ec02087f2e63c869d18c')).toBe('0x002c…d18c')
    expect(shortHash('0x' + 'a'.repeat(64))).toMatch(/^0xaaaaaaaa…aaaaaaaa$/)
  })

  it('formats wei into a trimmed decimal', () => {
    expect(formatValue(0n)).toBe('0')
    expect(formatValue(10n ** 18n)).toBe('1')
    expect(formatValue(1500000000000000000n)).toBe('1.5')
  })

  it('validates address shape', () => {
    expect(isAddressLike('0x002c67e5f1d6eec758e1ec02087f2e63c869d18c')).toBe(true)
    expect(isAddressLike('0xabc')).toBe(false)
    expect(isAddressLike('not-an-address')).toBe(false)
  })
})
