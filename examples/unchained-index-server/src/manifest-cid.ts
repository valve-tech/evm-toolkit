/**
 * Decode the manifest CID returned by the Unchained contract's
 * `manifestHashMap(address,string) returns (string)` view.
 *
 * The result is a single ABI-encoded dynamic `string`: a 32-byte offset
 * word, a 32-byte length word, then the UTF-8 bytes right-padded to a
 * 32-byte boundary. We skip the offset word, read the length, and slice
 * exactly that many bytes — the CID is short ASCII (e.g. `Qm…` / `bafy…`).
 *
 * Pure and total: a missing / empty result (`0x`) decodes to `''`, leaving
 * the caller to raise a chain-key-specific error.
 */
export const decodeManifestCid = (resultHex: string): string => {
  const hex = resultHex.startsWith('0x') ? resultHex.slice(2) : resultHex
  const len = parseInt(hex.slice(64, 128), 16)
  if (!Number.isFinite(len) || len <= 0) return ''
  return Buffer.from(hex.slice(128, 128 + len * 2), 'hex').toString('utf8')
}
