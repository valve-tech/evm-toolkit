import type { GasOracleState } from '@valve-tech/gas-oracle'
import { TIER_LADDER } from '@valve-tech/gas-oracle'

import type { ChainConfig } from '../config'
import { formatGwei, trendArrow } from '../lib/format'

interface CompareTableProps {
  chains: readonly ChainConfig[]
  states: ReadonlyMap<number, GasOracleState>
}

/**
 * Cross-chain compare: one column per chain, tier tips + base fee + trend
 * lined up. Chains without a first state yet render as dashes rather than
 * being hidden — an unresponsive RPC should be visible, not absent.
 */
export const CompareTable = ({
  chains,
  states,
}: CompareTableProps): JSX.Element => (
  <div className="panel">
    <h3>Compare (gwei tips)</h3>
    <table className="compare-table">
      <thead>
        <tr>
          <th />
          {chains.map((c) => (
            <th key={c.chainId}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {TIER_LADDER.map((name) => (
          <tr key={name}>
            <td className="muted">{name}</td>
            {chains.map((c) => {
              const state = states.get(c.chainId)
              return (
                <td key={c.chainId}>
                  {state
                    ? formatGwei(state.tiers[name].maxPriorityFeePerGas)
                    : '—'}
                </td>
              )
            })}
          </tr>
        ))}
        <tr>
          <td className="muted">base fee</td>
          {chains.map((c) => {
            const state = states.get(c.chainId)
            return (
              <td key={c.chainId}>
                {state
                  ? `${formatGwei(state.baseFee)} ${trendArrow(state.baseFeeTrend)}`
                  : '—'}
              </td>
            )
          })}
        </tr>
        <tr>
          <td className="muted">block</td>
          {chains.map((c) => {
            const state = states.get(c.chainId)
            return (
              <td key={c.chainId} className="muted">
                {state ? state.blockNumber.toString() : '—'}
              </td>
            )
          })}
        </tr>
      </tbody>
    </table>
  </div>
)
