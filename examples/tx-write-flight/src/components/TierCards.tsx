/**
 * The four gas-oracle tiers (slow/standard/fast/instant) as selectable cards,
 * each showing its maxFee (gwei) and the previewed total fee cost
 * (gasLimit * maxFeePerGas) in the native unit.
 */
import type { TierName, TierRecommendation } from '@valve-tech/gas-oracle'

import { estimateCostWei, formatAmount, formatGwei } from '../lib/format'

const TIERS: readonly TierName[] = ['slow', 'standard', 'fast', 'instant']

export interface TierCardsProps {
  tiers: Record<TierName, TierRecommendation> | null
  selected: TierName
  gasLimit: bigint
  symbol: string
  onSelect: (tier: TierName) => void
}

export const TierCards = ({
  tiers,
  selected,
  gasLimit,
  symbol,
  onSelect,
}: TierCardsProps): JSX.Element => (
  <div className="tier-cards" role="radiogroup" aria-label="Gas tier">
    {TIERS.map((tier) => {
      const rec = tiers?.[tier]
      const cost = rec ? estimateCostWei(gasLimit, rec.maxFeePerGas) : null
      return (
        <button
          key={tier}
          type="button"
          role="radio"
          aria-checked={selected === tier}
          className={`tier-card${selected === tier ? ' tier-card--active' : ''}`}
          disabled={!rec}
          onClick={() => onSelect(tier)}
        >
          <span className="tier-card__name">{tier}</span>
          <span className="tier-card__fee">
            {rec ? `${formatGwei(rec.maxFeePerGas)} gwei` : '—'}
          </span>
          <span className="tier-card__cost">
            {cost !== null ? `≈ ${formatAmount(cost)} ${symbol}` : 'warming up…'}
          </span>
        </button>
      )
    })}
  </div>
)
