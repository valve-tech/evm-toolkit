import { describe, it, expect } from 'vitest'
import type { TipSample } from '@valve-tech/gas-oracle'
import { bucketTips } from './histogram'

const s = (tip: bigint, gas = 21_000n): TipSample => ({ tip, gas })

describe('bucketTips', () => {
  it('returns an empty result for no samples', () => {
    const r = bucketTips([], 4, {})
    expect(r.buckets).toEqual([])
    expect(r.maxCount).toBe(0)
  })

  it('buckets samples into evenly-spaced tip ranges across [min,max]', () => {
    // tips 0,1,2,3 gwei into 4 buckets → one each
    const samples = [s(0n), s(1_000_000_000n), s(2_000_000_000n), s(3_000_000_000n)]
    const r = bucketTips(samples, 4, {})
    expect(r.buckets).toHaveLength(4)
    expect(r.buckets.map((b) => b.count)).toEqual([1, 1, 1, 1])
    expect(r.maxCount).toBe(1)
    // first bucket starts at min, last bucket ends at max
    expect(r.buckets[0].loTip).toBe(0n)
    expect(r.buckets[3].hiTip).toBe(3_000_000_000n)
  })

  it('collapses a single distinct tip into one fully-loaded bucket', () => {
    const r = bucketTips([s(5n), s(5n), s(5n)], 4, {})
    expect(r.buckets.reduce((n, b) => n + b.count, 0)).toBe(3)
    expect(r.maxCount).toBe(3)
  })

  it('maps tier cutoffs to bucket indices (the overlay positions)', () => {
    const samples = [s(0n), s(1_000_000_000n), s(2_000_000_000n), s(3_000_000_000n)]
    const r = bucketTips(samples, 4, {
      slow: 0n,
      standard: 1_000_000_000n,
      fast: 2_000_000_000n,
      instant: 3_000_000_000n,
    })
    // each cutoff lands in the bucket whose [lo,hi) range contains it
    expect(r.cutoffs.map((c) => c.bucketIndex)).toEqual([0, 1, 2, 3])
    expect(r.cutoffs.map((c) => c.tier)).toEqual(['slow', 'standard', 'fast', 'instant'])
  })
})
