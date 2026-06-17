/**
 * Address-scoped CIPHERTEXT store. The server stores envelope blobs
 * only and never the key — it is cryptographically blind to note
 * contents. Backed by a JSON file so notes survive a restart.
 * README: "a real app uses a database."
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { Address } from 'viem'

/** Base64-encoded AES-GCM ciphertext + its 12-byte IV ("nonce"). */
export interface StoredBlob {
  ciphertext: string
  nonce: string
}

export interface NoteStore {
  addNote(address: Address, blob: StoredBlob): void
  listNotes(address: Address): StoredBlob[]
}

type StoreShape = Record<string, StoredBlob[]>

/** Lowercase so checksum vs. non-checksum casing maps to one bucket. */
const key = (address: Address): string => address.toLowerCase()

export function createNoteStore(path: string): NoteStore {
  const read = (): StoreShape =>
    existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as StoreShape) : {}
  const write = (data: StoreShape): void => writeFileSync(path, JSON.stringify(data, null, 2))

  return {
    addNote(address, blob) {
      const data = read()
      const bucket = data[key(address)] ?? []
      bucket.push(blob)
      data[key(address)] = bucket
      write(data)
    },
    listNotes(address) {
      return read()[key(address)] ?? []
    },
  }
}
