/**
 * Compose pane: action selector (Send / Wrap / Unwrap, the last two disabled
 * off-registry), action-specific fields, the tier cards, and a Review & send
 * step that shows the resolved fee + total before the wallet prompt.
 */
import { useState } from 'react'
import type { Hex } from 'viem'
import type { TierName, TierRecommendation } from '@valve-tech/gas-oracle'

import type { Action } from '../lib/actions'
import { estimateCostWei, formatAmount, formatGwei } from '../lib/format'
import {
  DEFAULT_NATIVE_WEI,
  DEFAULT_UNWRAP_WEI,
  DEFAULT_WRAP_WEI,
} from '../config'
import { TierCards } from './TierCards'

type ActionKind = Action['kind']

export interface ComposePaneProps {
  connected: boolean
  account: Hex | null
  symbol: string
  wethSupported: boolean
  tiers: Record<TierName, TierRecommendation> | null
  selectedTier: TierName
  gasLimit: bigint
  onSelectTier: (tier: TierName) => void
  onSend: (action: Action) => void
  busy: boolean
}

// Static, conservative gas-limit estimates per action for the cost preview.
const ETH_DECIMALS = 18
const weiFromEthInput = (input: string): bigint => {
  const [whole = '0', frac = ''] = input.trim().split('.')
  const padded = (frac + '0'.repeat(ETH_DECIMALS)).slice(0, ETH_DECIMALS)
  return BigInt(whole || '0') * 10n ** BigInt(ETH_DECIMALS) + BigInt(padded || '0')
}

export const ComposePane = ({
  connected,
  account,
  symbol,
  wethSupported,
  tiers,
  selectedTier,
  gasLimit,
  onSelectTier,
  onSend,
  busy,
}: ComposePaneProps): JSX.Element => {
  const [kind, setKind] = useState<ActionKind>('send')
  const [to, setTo] = useState<string>(account ?? '')
  const [amount, setAmount] = useState<string>('0.001')
  const [reviewing, setReviewing] = useState(false)

  const amountWei =
    amount.trim() === ''
      ? kind === 'send'
        ? DEFAULT_NATIVE_WEI
        : kind === 'wrap'
          ? DEFAULT_WRAP_WEI
          : DEFAULT_UNWRAP_WEI
      : weiFromEthInput(amount)

  const rec = tiers?.[selectedTier] ?? null
  const costWei = rec ? estimateCostWei(gasLimit, rec.maxFeePerGas) : null

  const buildAction = (): Action => {
    if (kind === 'send')
      return { kind: 'send', to: (to || account || '0x') as Hex, amountWei }
    if (kind === 'wrap') return { kind: 'wrap', amountWei }
    return { kind: 'unwrap', amountWei }
  }

  return (
    <section className="pane pane--compose">
      <h2>Compose</h2>

      <div className="action-selector" role="tablist">
        {(['send', 'wrap', 'unwrap'] as const).map((k) => {
          const disabled = k !== 'send' && !wethSupported
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={`action-tab${kind === k ? ' action-tab--active' : ''}`}
              disabled={disabled}
              title={disabled ? 'No canonical WETH registered for this chain' : undefined}
              onClick={() => {
                setKind(k)
                setReviewing(false)
              }}
            >
              {k === 'send' ? 'Native send' : k === 'wrap' ? 'Wrap → WETH' : 'Unwrap → ETH'}
            </button>
          )
        })}
      </div>

      <div className="fields">
        {kind === 'send' && (
          <label>
            Recipient
            <input
              value={to}
              placeholder={account ?? '0x…'}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        )}
        <label>
          Amount ({kind === 'unwrap' ? 'WETH' : symbol})
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </label>
      </div>

      <TierCards
        tiers={tiers}
        selected={selectedTier}
        gasLimit={gasLimit}
        symbol={symbol}
        onSelect={onSelectTier}
      />

      {!reviewing ? (
        <button
          type="button"
          className="primary"
          disabled={!connected || busy}
          onClick={() => setReviewing(true)}
        >
          Review &amp; send
        </button>
      ) : (
        <div className="review">
          <h3>Review &amp; send</h3>
          <dl>
            <dt>Action</dt>
            <dd>{kind}</dd>
            <dt>Amount</dt>
            <dd>{formatAmount(amountWei)} {kind === 'unwrap' ? 'WETH' : symbol}</dd>
            <dt>Tier</dt>
            <dd>{selectedTier}</dd>
            <dt>Max fee</dt>
            <dd>{rec ? `${formatGwei(rec.maxFeePerGas)} gwei` : '—'}</dd>
            <dt>Est. fee cost</dt>
            <dd>{costWei !== null ? `≈ ${formatAmount(costWei)} ${symbol}` : '—'}</dd>
          </dl>
          <div className="review__actions">
            <button type="button" onClick={() => setReviewing(false)}>Back</button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                onSend(buildAction())
                setReviewing(false)
              }}
            >
              Confirm in wallet
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
