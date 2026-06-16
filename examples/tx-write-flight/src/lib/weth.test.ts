import { describe, it, expect } from 'vitest'

import { wethAddressFor, wethSupported } from './weth'

describe('WETH registry', () => {
  it('returns the canonical WETH address for a known chain', () => {
    expect(wethAddressFor(1)).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
    expect(wethAddressFor(8453)).toBe('0x4200000000000000000000000000000000000006')
  })

  it('returns null for a chain with no registered WETH', () => {
    expect(wethAddressFor(369)).toBeNull()
    expect(wethAddressFor(999999)).toBeNull()
  })

  it('wethSupported is the disable decision: true iff registered', () => {
    expect(wethSupported(1)).toBe(true)
    expect(wethSupported(42161)).toBe(true)
    expect(wethSupported(369)).toBe(false)
  })
})
