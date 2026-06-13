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

/** Human byte size: 1536 → "1.5 KB", 5_000_000 → "4.8 MB". */
export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}
