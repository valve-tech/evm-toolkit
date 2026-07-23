import { useEffect, useMemo, useRef, useState } from 'react'
import type { Capabilities } from '@valve-tech/chain-source'
import type { GasOracleState } from '@valve-tech/gas-oracle'

import { CHAINS, chainLabel } from './config'
import { createFleet } from './lib/fleet'
import {
  evaluateAlerts,
  loadRules,
  saveRules,
  type AlertFiring,
  type AlertRule,
} from './lib/alerts'
import { formatGwei } from './lib/format'
import { AlertsPanel } from './components/AlertsPanel'
import { ChainCard } from './components/ChainCard'
import { CompareTable } from './components/CompareTable'

const MAX_FIRINGS_SHOWN = 20

const notifySupport = (): NotificationPermission | 'unsupported' =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission

export const App = (): JSX.Element => {
  const [states, setStates] = useState<ReadonlyMap<number, GasOracleState>>(
    new Map(),
  )
  const [caps, setCaps] = useState<ReadonlyMap<number, Capabilities>>(new Map())
  const [errors, setErrors] = useState<ReadonlyMap<number, string>>(new Map())
  const [rules, setRules] = useState<AlertRule[]>(() => loadRules())
  const [firings, setFirings] = useState<AlertFiring[]>([])
  const [notifyState, setNotifyState] = useState(notifySupport)

  // Edge-trigger memory + a live view of the rules for the fleet callback.
  const matchingRef = useRef<ReadonlySet<string>>(new Set())
  const rulesRef = useRef(rules)
  rulesRef.current = rules

  // One fleet for the app's lifetime — all chains run concurrently.
  useEffect(() => {
    const fleet = createFleet(CHAINS, {
      onState: (chainId, state) => {
        setStates((prev) => {
          const next = new Map(prev)
          next.set(chainId, state)

          // Evaluate alert rules against the fresh fleet snapshot.
          const { firings: fresh, matching } = evaluateAlerts(
            next,
            rulesRef.current,
            matchingRef.current,
            Date.now(),
          )
          matchingRef.current = matching
          if (fresh.length > 0) {
            setFirings((old) =>
              [...fresh.reverse(), ...old].slice(0, MAX_FIRINGS_SHOWN),
            )
            if (
              typeof Notification !== 'undefined' &&
              Notification.permission === 'granted'
            ) {
              for (const f of fresh) {
                new Notification(
                  `${chainLabel(f.rule.chainId)}: ${f.rule.tier} tip ${formatGwei(f.tipWei)} gwei`,
                  {
                    body: `rule: ${f.rule.direction} ${f.rule.thresholdGwei} gwei — block ${f.blockNumber.toString()}`,
                  },
                )
              }
            }
          }
          return next
        })
        setErrors((prev) => {
          if (!prev.has(chainId)) return prev
          const next = new Map(prev)
          next.delete(chainId)
          return next
        })
      },
      onCapabilities: (chainId, c) =>
        setCaps((prev) => new Map(prev).set(chainId, c)),
      onError: (chainId, err) =>
        setErrors((prev) => new Map(prev).set(chainId, err.message)),
    })
    return () => fleet.dispose()
  }, [])

  const liveChains = useMemo(
    () => CHAINS.filter((c) => states.has(c.chainId)).length,
    [states],
  )

  const addRule = (rule: Omit<AlertRule, 'id'>): void => {
    const withId: AlertRule = {
      ...rule,
      id: `${rule.chainId}:${rule.tier}:${rule.direction}:${rule.thresholdGwei}:${Date.now()}`,
    }
    setRules((prev) => {
      const next = [...prev, withId]
      saveRules(next)
      return next
    })
  }

  const removeRule = (id: string): void => {
    setRules((prev) => {
      const next = prev.filter((r) => r.id !== id)
      saveRules(next)
      return next
    })
  }

  const enableNotifications = (): void => {
    void Notification.requestPermission().then(() =>
      setNotifyState(notifySupport()),
    )
  }

  return (
    <>
      <header>
        <strong>⛽ multi-chain gas</strong>
        <span className="muted">
          {liveChains}/{CHAINS.length} chains live
        </span>
      </header>

      <section className="cards-grid">
        {CHAINS.map((chain) => (
          <ChainCard
            key={chain.chainId}
            chain={chain}
            state={states.get(chain.chainId) ?? null}
            caps={caps.get(chain.chainId) ?? null}
            error={errors.get(chain.chainId) ?? null}
          />
        ))}
      </section>

      <section className="wide-grid">
        <CompareTable chains={CHAINS} states={states} />
        <AlertsPanel
          chains={CHAINS}
          rules={rules}
          firings={firings}
          notifyState={notifyState}
          onAddRule={addRule}
          onRemoveRule={removeRule}
          onEnableNotifications={enableNotifications}
        />
      </section>
    </>
  )
}
