import { formatGwei } from '../lib/format'

interface SparklineProps {
  /** Base-fee-per-gas history, oldest → newest (wei). From GasOracleState.baseFeeHistory. */
  history: bigint[]
  width?: number
  height?: number
}

export const Sparkline = ({ history, width = 360, height = 96 }: SparklineProps): JSX.Element => {
  if (history.length < 2) {
    return <p className="muted">Collecting base-fee samples…</p>
  }
  let min = history[0]
  let max = history[0]
  for (const v of history) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = max - min === 0n ? 1n : max - min
  const stepX = width / (history.length - 1)
  const y = (v: bigint): number =>
    height - Number(((v - min) * BigInt(Math.round(height - 4))) / span) - 2
  const points = history.map((v, i) => `${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  return (
    <div>
      <svg width={width} height={height} role="img" aria-label="base fee trend">
        <polyline points={points} fill="none" stroke="var(--ok)" strokeWidth={2} />
      </svg>
      <p className="muted">
        base fee {formatGwei(history[history.length - 1])} gwei (min {formatGwei(min)} · max{' '}
        {formatGwei(max)})
      </p>
    </div>
  )
}
