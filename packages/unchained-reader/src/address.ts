/**
 * Address hex <-> bytes helpers, shared by the bloom and chunk parsers.
 * Pure, zero-dependency — no viem, no Node Buffer (browser/RN safe).
 */

/** Lowercase, 0x-prefixed, 40-hex-character form of an address. */
export type HexAddress = `0x${string}`

const HEX_ADDR = /^(0x)?([0-9a-fA-F]{40})$/

/**
 * Parse an address string (with or without `0x`, any case) into its 20
 * raw bytes. Throws on anything that is not exactly 40 hex characters.
 */
export const addressToBytes = (address: string): Uint8Array => {
  const m = HEX_ADDR.exec(address.trim())
  if (!m) {
    throw new Error(`address: expected a 20-byte hex address, got ${JSON.stringify(address)}`)
  }
  const hex = m[2]
  const out = new Uint8Array(20)
  for (let i = 0; i < 20; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** Render 20 bytes as a lowercase 0x-prefixed address. */
export const bytesToAddress = (bytes: Uint8Array): HexAddress => {
  let hex = ''
  for (let i = 0; i < 20; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return `0x${hex}`
}

/** Normalize any accepted address form to lowercase 0x-prefixed. */
export const normalizeAddress = (address: string): HexAddress =>
  bytesToAddress(addressToBytes(address))

/**
 * True if the address is `<= 0xffff` — i.e. its high 18 bytes are all zero.
 * This is the precompile / reserved range (0x0…0000–0x0…ffff). chifra and
 * the Unchained Index do NOT index these, so querying one is meaningless;
 * worse, a near-zero bit pattern triggers bloom false-positives in nearly
 * every chunk. Treat as invalid in both the UI and any server.
 */
export const isReservedAddress = (address: string): boolean => {
  const bytes = addressToBytes(address)
  for (let i = 0; i < 18; i += 1) {
    if (bytes[i] !== 0) return false
  }
  return true
}
