/**
 * Pure histogram bucketing for the mempool tip panel. Buckets a
 * `TipSample[]` (typically `state.mempoolSamples`) into `n` evenly-spaced
 * tip ranges across [minTip, maxTip], and maps the four tier cutoffs onto
 * bucket indices so the SVG can draw overlay lines. No I/O, no oracle.
 */
import type { TipSample } from '@valve-tech/gas-oracle'
import { TIER_LADDER, type TierName } from '@valve-tech/gas-oracle'

export interface HistogramBucket {
  loTip: bigint
  hiTip: bigint
  count: number
  /** Sum of sample gas in this bucket — the gas-weighted height. */
  gas: bigint
}

export interface CutoffMark {
  tier: TierName
  tip: bigint
  /** Which bucket this cutoff falls into; clamped to [0, n-1]. */
  bucketIndex: number
}

export interface HistogramResult {
  buckets: HistogramBucket[]
  cutoffs: CutoffMark[]
  maxCount: number
  maxGas: bigint
}

/** Tier-cutoff tip values (maxPriorityFeePerGas per tier). Optional/partial. */
export type TierCutoffs = Partial<Record<TierName, bigint>>

export const bucketTips = (
  samples: TipSample[],
  n: number,
  cutoffs: TierCutoffs,
): HistogramResult => {
  if (samples.length === 0 || n <= 0) {
    return { buckets: [], cutoffs: [], maxCount: 0, maxGas: 0n }
  }

  let min = samples[0].tip
  let max = samples[0].tip
  for (const s of samples) {
    if (s.tip < min) min = s.tip
    if (s.tip > max) max = s.tip
  }

  const span = max - min
  const nBig = BigInt(n)
  // Bucket index for a tip: floor((tip-min)/span * n), clamped to [0,n-1].
  const indexFor = (tip: bigint): number => {
    if (span === 0n) return 0
    const idx = Number(((tip - min) * nBig) / span)
    return idx >= n ? n - 1 : idx < 0 ? 0 : idx
  }

  const buckets: HistogramBucket[] = []
  for (let i = 0; i < n; i += 1) {
    const lo = span === 0n ? min : min + (span * BigInt(i)) / nBig
    const hi = span === 0n ? max : min + (span * BigInt(i + 1)) / nBig
    buckets.push({ loTip: lo, hiTip: hi, count: 0, gas: 0n })
  }

  let maxCount = 0
  let maxGas = 0n
  for (const s of samples) {
    const b = buckets[indexFor(s.tip)]
    b.count += 1
    b.gas += s.gas
    if (b.count > maxCount) maxCount = b.count
    if (b.gas > maxGas) maxGas = b.gas
  }

  const marks: CutoffMark[] = []
  for (const tier of TIER_LADDER) {
    const tip = cutoffs[tier]
    if (tip === undefined) continue
    marks.push({ tier, tip, bucketIndex: indexFor(tip) })
  }

  return { buckets, cutoffs: marks, maxCount, maxGas }
}
