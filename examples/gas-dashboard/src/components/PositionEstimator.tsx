import { useState } from 'react'
import type { TipSample } from '@valve-tech/gas-oracle'
import type { BlockPositionMode } from '../lib/capabilities'
import { estimatePosition } from '../lib/position'
import { formatGwei, formatWei } from '../lib/format'

interface Props {
  /** The sample distribution to rank against (mempool+ring, or ring-only). */
  samples: TipSample[]
  mode: BlockPositionMode
}

const GWEI = 1_000_000_000n

export const PositionEstimator = ({ samples, mode }: Props): JSX.Element => {
  const [gweiInput, setGweiInput] = useState('1')

  let tip = 0n
  try {
    // Accept decimal gwei; convert to wei. Fall back to 0 on garbage input.
    const [whole, frac = ''] = gweiInput.trim().split('.')
    const fracPadded = (frac + '000000000').slice(0, 9)
    tip = BigInt(whole || '0') * GWEI + BigInt(fracPadded || '0')
  } catch {
    tip = 0n
  }

  const est = estimatePosition(samples, tip)

  return (
    <div className="panel">
      <h3>Block-position estimator</h3>
      <p className="muted">
        ranking against{' '}
        {mode === 'mempool' ? 'live mempool + recent blocks' : 'recent block-included tips'} (
        {est.total} samples)
      </p>
      <label>
        your tip (gwei){' '}
        <input
          value={gweiInput}
          onChange={(e) => setGweiInput(e.target.value)}
          inputMode="decimal"
        />
      </label>
      {est.total === 0 ? (
        <p className="muted">No samples yet — wait for a block.</p>
      ) : (
        <ul>
          <li>
            rank <strong>#{est.rank}</strong> of {est.total} (top {100 - est.percentile}% pay
            more)
          </li>
          <li>
            percentile <strong>{est.percentile}</strong>
          </li>
          <li>gas ahead of you: {formatWei(est.gasAhead)}</li>
          <li className="muted">tip parsed as {formatGwei(tip)} gwei</li>
        </ul>
      )}
    </div>
  )
}
