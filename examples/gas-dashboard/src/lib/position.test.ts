import { describe, it, expect } from 'vitest'
import type { TipSample } from '@valve-tech/gas-oracle'
import { estimatePosition, tipForRank } from './position'

const s = (tip: bigint, gas = 21_000n): TipSample => ({ tip, gas })

describe('estimatePosition', () => {
  it('reports empty distribution', () => {
    const r = estimatePosition([], 5n)
    expect(r).toEqual({ rank: 0, total: 0, percentile: 0, gasAhead: 0n })
  })

  it('ranks a tip by how many samples it would outrank (tip-desc)', () => {
    // distribution tips: 10,8,6,4,2 ; my tip 7 outranks 6,4,2 → rank 2 from top
    const samples = [s(10n), s(8n), s(6n), s(4n), s(2n)]
    const r = estimatePosition(samples, 7n)
    expect(r.total).toBe(5)
    expect(r.rank).toBe(2) // two samples (10,8) are ahead
    // gas ahead = gas of the 2 samples that outrank me
    expect(r.gasAhead).toBe(42_000n)
    // percentile: fraction of the field at or below my tip → here 3/5 = 60
    expect(r.percentile).toBe(60)
  })

  it('a top tip lands at rank 0 with 100th percentile', () => {
    const samples = [s(5n), s(4n), s(3n)]
    const r = estimatePosition(samples, 9n)
    expect(r.rank).toBe(0)
    expect(r.percentile).toBe(100)
  })
})

describe('tipForRank', () => {
  it('delegates to gas-oracle tipForBlockPosition (rank query, bigint rank)', () => {
    const samples = [s(10n), s(8n), s(6n), s(4n), s(2n)]
    const out = tipForRank(samples, 2n)
    // pivotIndex=2 → sorted[2].tip=6 → requiredTip = 6 + 1 = 7 (rank is 0-indexed pivot)
    expect(out.requiredTip).toBe(7n)
  })
})
