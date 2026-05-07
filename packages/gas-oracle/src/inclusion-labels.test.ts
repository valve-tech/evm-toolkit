import { describe, expect, it } from 'vitest'
import { defaultInclusionLabels, inclusionLabel } from './inclusion-labels.js'
import { TierName } from './types.js'

describe('defaultInclusionLabels', () => {
  it('has an entry for every TierName', () => {
    const tiers = Object.values(TierName)
    for (const tier of tiers) {
      expect(defaultInclusionLabels[tier]).toBeTruthy()
      expect(typeof defaultInclusionLabels[tier]).toBe('string')
    }
  })

  it('has a label for each named tier', () => {
    expect(defaultInclusionLabels[TierName.slow]).toBe('Within a few blocks')
    expect(defaultInclusionLabels[TierName.standard]).toBe('Next block')
    expect(defaultInclusionLabels[TierName.fast]).toBe('Top of next block')
    expect(defaultInclusionLabels[TierName.instant]).toBe('Front of next block')
  })
})

describe('inclusionLabel', () => {
  it('returns the default for every tier when no overrides', () => {
    for (const tier of Object.values(TierName)) {
      expect(inclusionLabel(tier)).toBe(defaultInclusionLabels[tier])
    }
  })

  it('returns the override when present', () => {
    const overrides = { [TierName.standard]: 'Próximo bloque' }
    expect(inclusionLabel(TierName.standard, overrides)).toBe('Próximo bloque')
  })

  it('falls back to default for tiers not in overrides', () => {
    const overrides = { [TierName.standard]: 'Próximo bloque' }
    expect(inclusionLabel(TierName.slow, overrides)).toBe(defaultInclusionLabels[TierName.slow])
    expect(inclusionLabel(TierName.fast, overrides)).toBe(defaultInclusionLabels[TierName.fast])
  })

  it('spread pattern produces a complete replacement map', () => {
    const partial = { [TierName.slow]: 'Patience' }
    const full = { ...defaultInclusionLabels, ...partial }
    expect(full[TierName.slow]).toBe('Patience')
    expect(full[TierName.standard]).toBe(defaultInclusionLabels[TierName.standard])
  })
})
