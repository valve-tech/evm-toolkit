import { useState } from 'react'
import { TIER_LADDER, type TierName } from '@valve-tech/gas-oracle'

import { chainLabel, type ChainConfig } from '../config'
import {
  AlertDirection,
  type AlertFiring,
  type AlertRule,
} from '../lib/alerts'
import { formatGwei } from '../lib/format'

interface AlertsPanelProps {
  chains: readonly ChainConfig[]
  rules: readonly AlertRule[]
  firings: readonly AlertFiring[]
  notifyState: NotificationPermission | 'unsupported'
  onAddRule: (rule: Omit<AlertRule, 'id'>) => void
  onRemoveRule: (id: string) => void
  onEnableNotifications: () => void
}

/** Rule editor + recent-firings log + browser-notification opt-in. */
export const AlertsPanel = ({
  chains,
  rules,
  firings,
  notifyState,
  onAddRule,
  onRemoveRule,
  onEnableNotifications,
}: AlertsPanelProps): JSX.Element => {
  const [chainId, setChainId] = useState(chains[0]?.chainId ?? 1)
  const [tier, setTier] = useState<TierName>('fast')
  const [direction, setDirection] = useState<AlertDirection>(
    AlertDirection.below,
  )
  const [threshold, setThreshold] = useState('2')

  const submit = (): void => {
    const thresholdGwei = Number(threshold)
    if (!Number.isFinite(thresholdGwei) || thresholdGwei <= 0) return
    onAddRule({ chainId, tier, direction, thresholdGwei })
  }

  return (
    <div className="panel">
      <h3>Alerts</h3>

      <div className="rule-editor">
        <select
          value={chainId}
          onChange={(e) => setChainId(Number(e.target.value))}
        >
          {chains.map((c) => (
            <option key={c.chainId} value={c.chainId}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value as TierName)}
        >
          {TIER_LADDER.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as AlertDirection)}
        >
          <option value={AlertDirection.below}>tip below</option>
          <option value={AlertDirection.above}>tip above</option>
        </select>
        <input
          className="threshold"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          placeholder="gwei"
          inputMode="decimal"
        />
        <button onClick={submit}>add rule</button>
        {notifyState === 'default' && (
          <button onClick={onEnableNotifications}>
            enable browser notifications
          </button>
        )}
        {notifyState === 'denied' && (
          <span className="muted">notifications blocked by the browser</span>
        )}
      </div>

      {rules.length === 0 ? (
        <p className="muted">
          no rules — e.g. add “Ethereum · fast · tip below · 2” to hear about
          cheap blocks.
        </p>
      ) : (
        <ul className="rule-list">
          {rules.map((r) => (
            <li key={r.id}>
              {chainLabel(r.chainId)} · {r.tier} · {r.direction}{' '}
              {r.thresholdGwei} gwei{' '}
              <button className="link" onClick={() => onRemoveRule(r.id)}>
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {firings.length > 0 && (
        <>
          <h4 className="muted">recent firings</h4>
          <ul className="firing-list">
            {firings.map((f, i) => (
              <li key={`${f.rule.id}-${f.firedAt}-${i}`}>
                <span className="fired">⚡</span> {chainLabel(f.rule.chainId)}{' '}
                {f.rule.tier} tip {formatGwei(f.tipWei)} gwei ({f.rule.direction}{' '}
                {f.rule.thresholdGwei}) at block {f.blockNumber.toString()}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
