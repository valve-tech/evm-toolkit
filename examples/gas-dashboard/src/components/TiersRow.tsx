import type { GasOracleState } from '@valve-tech/gas-oracle'
import { TIER_LADDER } from '@valve-tech/gas-oracle'
import { formatGwei } from '../lib/format'

export const TiersRow = ({ tiers }: { tiers: GasOracleState['tiers'] }): JSX.Element => (
  <section className="tiers">
    {TIER_LADDER.map((name) => {
      const t = tiers[name]
      return (
        <div className="tier-card" key={name}>
          <h3>{name}</h3>
          <div>
            tip <strong>{formatGwei(t.maxPriorityFeePerGas)}</strong> gwei
          </div>
          <div className="muted">max {formatGwei(t.maxFeePerGas)} gwei</div>
        </div>
      )
    })}
  </section>
)
