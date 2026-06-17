import { useState } from 'react'

interface Props {
  busy: boolean
  onSave: (text: string) => void
}

export function Composer({ busy, onSave }: Props) {
  const [text, setText] = useState('')
  const save = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSave(trimmed)
    setText('')
  }
  return (
    <div className="composer">
      <textarea
        placeholder="write a private note…"
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="primary" disabled={busy || !text.trim()} onClick={save}>
        {busy ? 'Encrypting…' : 'Encrypt & save'}
      </button>
    </div>
  )
}
