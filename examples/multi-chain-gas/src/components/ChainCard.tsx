import type { Capabilities } from '@valve-tech/chain-source'
import type { GasOracleState } from '@valve-tech/gas-oracle'
import { TIER_LADDER } from '@valve-tech/gas-oracle'

import type { ChainConfig } from '../config'
import { formatGwei, trendArrow } from '../lib/format'
import { Sparkline } from './Sparkline'

interface ChainCardProps {
  chain: ChainConfig
  state: GasOracleState | null
  caps: Capabilities | null
  error: string | null
}

/** One chain's live panel: tiers, trend, base-fee sparkline, capability note. */
export const ChainCard = ({
  chain,
  state,
  caps,
  error,
}: ChainCardProps): JSX.Element => (
  <div className="panel chain-card">
    <h3>
      {chain.label} <span className="muted">({chain.chainId})</span>
      {state && (
        <span className="muted block-no">
          {' '}
          block {state.blockNumber.toString()}{' '}
          {trendArrow(state.baseFeeTrend)}
        </span>
      )}
    </h3>

    {error && <p className="card-error">RPC error: {error}</p>}

    {!state ? (
      <p className="muted">connecting…</p>
    ) : (
      <>
        <table className="tier-table">
          <tbody>
            {TIER_LADDER.map((name) => (
              <tr key={name}>
                <td className="muted">{name}</td>
                <td>
                  <strong>
                    {formatGwei(state.tiers[name].maxPriorityFeePerGas)}
                  </strong>{' '}
                  gwei tip
                </td>
                <td className="muted">
                  max {formatGwei(state.tiers[name].maxFeePerGas)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Sparkline history={state.baseFeeHistory} width={300} height={64} />
        {caps && caps.newHeads !== 'subscription' && (
          <p className="muted">http polling (no WS push on this RPC)</p>
        )}
      </>
    )}
  </div>
)
