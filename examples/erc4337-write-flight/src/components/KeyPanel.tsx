import { useState } from 'react'
import type { Hex } from 'viem'

interface KeyPanelProps {
  ownerKey: Hex | null
  ownerAddress: string | null
  onGenerate: () => void
  onImport: (raw: string) => boolean
  onForget: () => void
}

/** Demo owner key controls, with the warning front and center. */
export const KeyPanel = ({
  ownerKey,
  ownerAddress,
  onGenerate,
  onImport,
  onForget,
}: KeyPanelProps): JSX.Element => {
  const [importValue, setImportValue] = useState('')
  const [importError, setImportError] = useState(false)
  const [revealed, setRevealed] = useState(false)

  return (
    <div className="panel">
      <h3>Demo owner key</h3>
      <p className="warn">
        ⚠ throwaway key in localStorage — the whole account is exactly as
        secure as this browser profile. Testnet / local funds only, ever.
      </p>

      {ownerKey === null ? (
        <div className="rule-editor">
          <button onClick={onGenerate}>generate demo key</button>
          <input
            placeholder="or paste a 0x… demo key"
            value={importValue}
            onChange={(e) => {
              setImportValue(e.target.value)
              setImportError(false)
            }}
          />
          <button
            onClick={() => {
              const ok = onImport(importValue)
              setImportError(!ok)
              if (ok) setImportValue('')
            }}
          >
            import
          </button>
          {importError && <span className="warn">not a 32-byte hex key</span>}
        </div>
      ) : (
        <>
          <p>
            owner (EOA): <code>{ownerAddress}</code>
          </p>
          <div className="rule-editor">
            <button onClick={() => setRevealed((r) => !r)}>
              {revealed ? 'hide key' : 'reveal key'}
            </button>
            <button onClick={onForget}>forget key</button>
          </div>
          {revealed && <code className="keyhex">{ownerKey}</code>}
        </>
      )}
    </div>
  )
}
