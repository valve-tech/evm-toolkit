import { useState } from 'react'
import type { WireBlob } from '../lib/blob.js'

export interface NoteRow {
  blob: WireBlob
  /** Decrypted text once revealed; undefined while still locked. */
  plaintext?: string
}

interface Props {
  notes: NoteRow[]
  onDecrypt: (index: number) => Promise<void>
}

export function NoteList({ notes, onDecrypt }: Props) {
  const [pending, setPending] = useState<number | null>(null)
  if (notes.length === 0) return <p className="empty">No notes yet. Write your first above.</p>
  return (
    <ul className="notes">
      {notes.map((note, i) => (
        <li key={i} className={note.plaintext === undefined ? 'note locked' : 'note open'}>
          {note.plaintext === undefined ? (
            <button
              className="reveal"
              disabled={pending === i}
              onClick={() => {
                setPending(i)
                void onDecrypt(i).finally(() => setPending(null))
              }}
            >
              {pending === i ? 'Decrypting…' : '🔒 tap to decrypt'}
            </button>
          ) : (
            <span className="plaintext">{note.plaintext}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
