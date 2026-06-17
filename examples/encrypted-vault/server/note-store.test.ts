import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNoteStore, type StoredBlob } from './note-store'

const ALICE = '0xAAAaAAaaAaaaAaaAaAAAAaaAAAaAAAAaAaAaAAAa' as const
const BOB = '0xBBbBBBBbBBbBbBbbBbbbBBbBBBBBbBbbBbBBbBBB' as const
const blob = (n: number): StoredBlob => ({ ciphertext: `ct-${n}`, nonce: `iv-${n}` })

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vault-'))
  path = join(dir, 'store.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('note store address isolation', () => {
  it('returns only the blobs written under the requesting address', () => {
    const store = createNoteStore(path)
    store.addNote(ALICE, blob(1))
    store.addNote(BOB, blob(2))
    store.addNote(ALICE, blob(3))
    expect(store.listNotes(ALICE)).toEqual([blob(1), blob(3)])
    expect(store.listNotes(BOB)).toEqual([blob(2)])
  })

  it('normalizes address casing so the same wallet sees its notes', () => {
    const store = createNoteStore(path)
    store.addNote(ALICE, blob(1))
    expect(store.listNotes(ALICE.toLowerCase() as typeof ALICE)).toEqual([blob(1)])
  })

  it('returns an empty list for an address with no notes', () => {
    const store = createNoteStore(path)
    expect(store.listNotes(BOB)).toEqual([])
  })

  it('persists across store instances (survives restart)', () => {
    createNoteStore(path).addNote(ALICE, blob(1))
    expect(createNoteStore(path).listNotes(ALICE)).toEqual([blob(1)])
  })
})
