import { describe, it, expect } from 'vitest'
import { formatGwei, formatWei, trendArrow } from './format'

describe('formatGwei', () => {
  it('renders wei as a trimmed gwei string', () => {
    expect(formatGwei(0n)).toBe('0')
    expect(formatGwei(1_000_000_000n)).toBe('1')
    expect(formatGwei(1_500_000_000n)).toBe('1.5')
    expect(formatGwei(1_234_567_890n)).toBe('1.23457') // 6 sig frac digits, trimmed
  })
  it('handles sub-gwei tips without dropping to 0', () => {
    expect(formatGwei(123_456_789n)).toBe('0.123457')
  })
})

describe('formatWei', () => {
  it('passes integers through with thousands separators', () => {
    expect(formatWei(0n)).toBe('0')
    expect(formatWei(1_500_000_000n)).toBe('1,500,000,000')
  })
})

describe('trendArrow', () => {
  it('maps the gas-oracle Trend union to a glyph', () => {
    expect(trendArrow('rising')).toBe('▲')
    expect(trendArrow('falling')).toBe('▼')
    expect(trendArrow('stable')).toBe('▬')
  })
})
