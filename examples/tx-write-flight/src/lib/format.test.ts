import { describe, it, expect } from 'vitest'

import {
  formatAmount,
  formatGwei,
  estimateCostWei,
  shortHash,
  shortAddr,
} from './format'

describe('format helpers', () => {
  it('formats wei into a trimmed native-unit decimal', () => {
    expect(formatAmount(0n)).toBe('0')
    expect(formatAmount(10n ** 18n)).toBe('1')
    expect(formatAmount(1_500_000_000_000_000_000n)).toBe('1.5')
    expect(formatAmount(1_000_000_000_000_000n)).toBe('0.001')
  })

  it('formats a fee in gwei', () => {
    expect(formatGwei(0n)).toBe('0')
    expect(formatGwei(1_000_000_000n)).toBe('1')
    expect(formatGwei(1_500_000_000n)).toBe('1.5')
  })

  it('estimates total fee cost as gasLimit * maxFeePerGas', () => {
    expect(estimateCostWei(21_000n, 20_000_000_000n)).toBe(420_000_000_000_000n)
  })

  it('shortens hashes and addresses', () => {
    expect(shortAddr('0x002c67e5f1d6eec758e1ec02087f2e63c869d18c')).toBe('0x002c…d18c')
    expect(shortHash('0x' + 'a'.repeat(64))).toMatch(/^0xaaaaaaaa…aaaaaaaa$/)
  })
})
