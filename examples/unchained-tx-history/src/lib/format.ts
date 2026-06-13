/** Display helpers — all pure. */

export const shortHash = (h: string, lead = 10, tail = 8): string =>
  h.length <= lead + tail ? h : `${h.slice(0, lead)}…${h.slice(-tail)}`

export const shortAddr = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`

/** Format a wei value as a decimal string in the chain's native unit. */
export const formatValue = (wei: bigint, decimals = 18): string => {
  if (wei === 0n) return '0'
  const base = 10n ** BigInt(decimals)
  const whole = wei / base
  const frac = wei % base
  if (frac === 0n) return whole.toString()
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, 6)
  return `${whole.toString()}.${fracStr}`
}

export const isAddressLike = (s: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(s.trim())
