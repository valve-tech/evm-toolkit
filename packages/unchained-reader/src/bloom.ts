/**
 * Unchained Index bloom-filter parsing + membership.
 *
 * Pure: functions over `Uint8Array`, no I/O. The binary layout and the
 * bit-selection algorithm are vendored verbatim from the TrueBlocks
 * reader (`trueblocks-chifra/pkg/index/bloom.go`,
 * `bloom_ismember.go`) — do not "simplify" the offsets without
 * re-verifying against a real published bloom; the magic numbers and the
 * `index = WIDTH - which - 1` reversal are load-bearing.
 *
 * File layout (all integers little-endian):
 *   [0,2)    Magic  uint16 = 0xdead
 *   [2,34)   Hash   32 bytes (version specifier; not checked here)
 *   [34,38)  Count  uint32 = number of "blooms" (adaptive bloom filter)
 *   then Count × { NInserted uint32 ; Bytes [131072] }
 *
 * Membership: an address yields five bits (each a big-endian uint32 of a
 * 4-byte slice, mod the bit width). The address "might be present" in a
 * bloom iff all five of its bits are set there; present in the file iff
 * present in ANY bloom. False positives are possible; false negatives are
 * not.
 */
import { addressToBytes } from './address.js'

const BLOOM_MAGIC = 0xdead
const HEADER_SIZE = 34 // uint16 magic + 32-byte hash
const COUNT_SIZE = 4
const N_INSERTED_SIZE = 4
const BLOOM_WIDTH_IN_BITS = 1048576
const BLOOM_WIDTH_IN_BYTES = BLOOM_WIDTH_IN_BITS / 8 // 131072

/** A parsed bloom filter: the raw bytes plus the decoded bloom count. */
export interface Bloom {
  /** Number of adaptive sub-filters in this file. */
  count: number
  /** The whole file, retained for lazy bit reads during membership tests. */
  readonly bytes: Uint8Array
}

/** Validate the header and decode the bloom count. Does not copy the body. */
export const parseBloom = (bytes: Uint8Array): Bloom => {
  if (bytes.length < HEADER_SIZE + COUNT_SIZE) {
    throw new Error(`bloom: file too short (${bytes.length} bytes)`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = view.getUint16(0, true)
  if (magic !== BLOOM_MAGIC) {
    throw new Error(
      `bloom: bad magic 0x${magic.toString(16)} (expected 0x${BLOOM_MAGIC.toString(16)})`,
    )
  }
  const count = view.getUint32(HEADER_SIZE, true)
  return { count, bytes }
}

/**
 * Five bit positions for an address, per the TrueBlocks algorithm: split
 * the 20 bytes into five big-endian 4-byte words, each taken modulo the
 * bit width.
 */
const addressToBits = (address: string): number[] => {
  const addr = addressToBytes(address)
  const view = new DataView(addr.buffer, addr.byteOffset, addr.byteLength)
  const bits: number[] = []
  for (let i = 0; i < 20; i += 4) {
    bits.push(view.getUint32(i, false) % BLOOM_WIDTH_IN_BITS)
  }
  return bits
}

/** Is `bit` set within the bloom body starting at `bodyStart`? */
const isBitLit = (bytes: Uint8Array, bodyStart: number, bit: number): boolean => {
  const which = Math.floor(bit / 8)
  const index = BLOOM_WIDTH_IN_BYTES - which - 1 // TrueBlocks stores bytes reversed
  const whence = bit % 8
  const mask = 1 << whence
  return (bytes[bodyStart + index] & mask) !== 0
}

/**
 * Probabilistic membership: `true` means the address MAY appear in the
 * corresponding index chunk (fetch + parse it to be sure); `false` means
 * it definitely does not (skip the chunk entirely).
 */
export const mightContain = (bloom: Bloom, address: string): boolean => {
  const bits = addressToBits(address)
  // First bloom body begins after header + count + the first NInserted.
  let bodyStart = HEADER_SIZE + COUNT_SIZE + N_INSERTED_SIZE
  for (let j = 0; j < bloom.count; j += 1) {
    if (bits.every((bit) => isBitLit(bloom.bytes, bodyStart, bit))) {
      return true
    }
    bodyStart += BLOOM_WIDTH_IN_BYTES + N_INSERTED_SIZE
  }
  return false
}
