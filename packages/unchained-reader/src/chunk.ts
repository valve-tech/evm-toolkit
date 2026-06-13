/**
 * Unchained Index chunk parsing — the authoritative address → appearances
 * table. Pure: functions over `Uint8Array`, no I/O.
 *
 * Binary layout vendored from the TrueBlocks reader
 * (`trueblocks-chifra/pkg/index/index_header_record.go`,
 * `index_address_record.go`, `index_appearance_record.go`). All integers
 * little-endian:
 *
 *   Header (44 bytes):
 *     [0,4)    Magic            uint32 = 0xdeadbeef
 *     [4,36)   Hash             32 bytes (version specifier; not checked)
 *     [36,40)  AddressCount     uint32
 *     [40,44)  AppearanceCount  uint32
 *   Address table @ 44, AddressCount × 28, SORTED ASCENDING by address:
 *     [0,20)   Address          20 bytes
 *     [20,24)  Offset           uint32  (record index into appearance table)
 *     [24,28)  Count            uint32
 *   Appearance table @ 44 + 28*AddressCount, AppearanceCount × 8:
 *     [0,4)    BlockNumber      uint32
 *     [4,8)    TransactionIndex uint32
 *
 * The address table is sorted, so lookups are a binary search — matching
 * how chifra reads it (it never loads the whole table into memory).
 */
import { addressToBytes } from './address.js'
import type { Appearance } from './types.js'

const CHUNK_MAGIC = 0xdeadbeef
const HEADER_WIDTH = 44
const ADDR_RECORD_WIDTH = 28
const APP_RECORD_WIDTH = 8

/** Decoded chunk header: the two table sizes. */
export interface ChunkHeader {
  addressCount: number
  appearanceCount: number
}

const viewOf = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** Validate the magic number and read the address / appearance counts. */
export const parseChunkHeader = (bytes: Uint8Array): ChunkHeader => {
  if (bytes.length < HEADER_WIDTH) {
    throw new Error(`chunk: file too short (${bytes.length} bytes)`)
  }
  const view = viewOf(bytes)
  const magic = view.getUint32(0, true)
  if (magic !== CHUNK_MAGIC) {
    throw new Error(
      `chunk: bad magic 0x${magic.toString(16)} (expected 0x${CHUNK_MAGIC.toString(16)})`,
    )
  }
  return {
    addressCount: view.getUint32(36, true),
    appearanceCount: view.getUint32(40, true),
  }
}

/** Compare the 20-byte address record at `recOffset` against `target`. */
const compareAddressAt = (bytes: Uint8Array, recOffset: number, target: Uint8Array): number => {
  for (let i = 0; i < 20; i += 1) {
    const d = bytes[recOffset + i] - target[i]
    if (d !== 0) return d
  }
  return 0
}

/**
 * Every appearance `(blockNumber, transactionIndex)` of `address` in this
 * chunk, in stored order. Returns `[]` when the address is absent. The
 * address table is binary-searched; only the matched address's
 * appearance slice is decoded.
 */
export const appearancesOf = (bytes: Uint8Array, address: string): Appearance[] => {
  const target = addressToBytes(address)
  const { addressCount } = parseChunkHeader(bytes)
  const view = viewOf(bytes)

  // Binary search the sorted address table.
  let lo = 0
  let hi = addressCount - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const rec = HEADER_WIDTH + mid * ADDR_RECORD_WIDTH
    const cmp = compareAddressAt(bytes, rec, target)
    if (cmp === 0) {
      found = rec
      break
    }
    if (cmp < 0) lo = mid + 1
    else hi = mid - 1
  }
  if (found === -1) return []

  const offset = view.getUint32(found + 20, true)
  const count = view.getUint32(found + 24, true)

  const appTableStart = HEADER_WIDTH + addressCount * ADDR_RECORD_WIDTH
  const appearances: Appearance[] = []
  for (let k = 0; k < count; k += 1) {
    const rec = appTableStart + (offset + k) * APP_RECORD_WIDTH
    appearances.push({
      blockNumber: BigInt(view.getUint32(rec, true)),
      transactionIndex: BigInt(view.getUint32(rec + 4, true)),
    })
  }
  return appearances
}
