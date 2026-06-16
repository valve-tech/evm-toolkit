/** Display helpers — all pure. Fees print in gwei; raw counts get separators. */

import type { Trend } from '@valve-tech/gas-oracle'

const GWEI = 1_000_000_000n

/** Format a wei value as a trimmed gwei decimal string (6 significant figures, trimmed). */
export const formatGwei = (wei: bigint): string => {
  if (wei === 0n) return '0'
  const whole = wei / GWEI
  const frac = wei % GWEI
  if (frac === 0n) return whole.toString()
  // Determine how many frac digits to keep: 6 sig figs total, minus digits in whole part
  const wholeDigits = whole === 0n ? 0 : whole.toString().length
  const fracDigits = Math.max(1, 6 - wholeDigits)
  // Round frac to fracDigits decimal places (frac is out of 10^9)
  const scale = 9 - fracDigits
  const divisor = BigInt(10 ** scale)
  const rounded = (frac + divisor / 2n) / divisor
  const fracStr = rounded.toString().padStart(fracDigits, '0').replace(/0+$/, '')
  return fracStr === '' ? whole.toString() : `${whole.toString()}.${fracStr}`
}

/** Format a bigint with thousands separators (for raw wei / counts). */
export const formatWei = (n: bigint): string =>
  n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Map a gas-oracle `Trend` to a single-glyph indicator. */
export const trendArrow = (t: Trend): string =>
  t === 'rising' ? '▲' : t === 'falling' ? '▼' : '▬'
