/**
 * Block-position helpers for the estimator panel.
 *
 * `estimatePosition` answers "where does MY tip land" — given a user tip and
 * a sample distribution, returns rank-from-top, the field size, a percentile,
 * and the gas ahead of you. Pure; the inverse of gas-oracle's
 * `tipForBlockPosition` (which answers "what tip do I need for position X").
 *
 * `tipForRank` re-exposes the package helper for the "tip to land in top N"
 * readout, so the panel can show both directions from the same data.
 */
import { tipForBlockPosition, type BlockPositionResult } from '@valve-tech/gas-oracle'
import type { TipSample } from '@valve-tech/gas-oracle'

export interface PositionEstimate {
  /** 0-indexed rank from the top — how many samples outrank your tip. */
  rank: number
  /** Total samples in the distribution. */
  total: number
  /** Percentile of the field at or below your tip (0–100, integer). */
  percentile: number
  /** Sum of gas for the samples that outrank you. */
  gasAhead: bigint
}

export const estimatePosition = (samples: TipSample[], tip: bigint): PositionEstimate => {
  const total = samples.length
  if (total === 0) return { rank: 0, total: 0, percentile: 0, gasAhead: 0n }

  let ahead = 0
  let gasAhead = 0n
  let atOrBelow = 0
  for (const s of samples) {
    if (s.tip > tip) {
      ahead += 1
      gasAhead += s.gas
    } else {
      atOrBelow += 1
    }
  }
  const percentile = Math.round((atOrBelow / total) * 100)
  return { rank: ahead, total, percentile, gasAhead }
}

/** "What tip do I need to land in the top `rank`?" — delegates to the oracle. */
export const tipForRank = (samples: TipSample[], rank: bigint): BlockPositionResult =>
  tipForBlockPosition(samples, { kind: 'rank', rank })
