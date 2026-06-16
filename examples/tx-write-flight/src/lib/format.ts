/** Display + cost helpers — all pure. */

/** Trim a fixed-decimal bigint to a clean decimal string (max 6 frac digits). */
const trimUnits = (value: bigint, decimals: number): string => {
  if (value === 0n) return '0'
  const base = 10n ** BigInt(decimals)
  const whole = value / base
  const frac = value % base
  if (frac === 0n) return whole.toString()
  const fracStr = frac
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '')
    .slice(0, 6)
  return `${whole.toString()}.${fracStr}`
}

/** Format a wei value as a decimal string in the chain's native unit (18dp). */
export const formatAmount = (wei: bigint): string => trimUnits(wei, 18)

/** Format a wei-per-gas fee as gwei (9dp). */
export const formatGwei = (wei: bigint): string => trimUnits(wei, 9)

/** Worst-case fee cost in wei: gasLimit * maxFeePerGas. */
export const estimateCostWei = (gasLimit: bigint, maxFeePerGas: bigint): bigint =>
  gasLimit * maxFeePerGas

export const shortHash = (h: string, lead = 10, tail = 8): string =>
  h.length <= lead + tail ? h : `${h.slice(0, lead)}…${h.slice(-tail)}`

export const shortAddr = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`
