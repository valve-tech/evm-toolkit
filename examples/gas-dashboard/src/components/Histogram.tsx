import type { HistogramResult } from '../lib/histogram'
import { formatGwei } from '../lib/format'

interface HistogramProps {
  data: HistogramResult
  width?: number
  height?: number
}

const TIER_COLOR: Record<string, string> = {
  slow: '#6b7785',
  standard: '#3fd1a3',
  fast: '#e0a44b',
  instant: '#e06a6a',
}

export const Histogram = ({ data, width = 360, height = 120 }: HistogramProps): JSX.Element => {
  if (data.buckets.length === 0 || data.maxCount === 0) {
    return <p className="muted">No pending samples to chart.</p>
  }
  const n = data.buckets.length
  const barW = width / n
  return (
    <svg width={width} height={height} role="img" aria-label="mempool tip histogram">
      {data.buckets.map((b, i) => {
        const h = (b.count / data.maxCount) * (height - 4)
        return (
          <rect
            key={i}
            x={i * barW + 1}
            y={height - h}
            width={Math.max(barW - 2, 1)}
            height={h}
            fill="var(--line)"
          />
        )
      })}
      {data.cutoffs.map((c) => {
        const x = (c.bucketIndex + 0.5) * barW
        return (
          <g key={c.tier}>
            <line
              x1={x}
              y1={0}
              x2={x}
              y2={height}
              stroke={TIER_COLOR[c.tier] ?? 'white'}
              strokeWidth={1.5}
              strokeDasharray="3 2"
            >
              <title>
                {c.tier}: {formatGwei(c.tip)} gwei
              </title>
            </line>
          </g>
        )
      })}
    </svg>
  )
}
