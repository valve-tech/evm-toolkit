/**
 * Pure tests for the alert engine: matching semantics (below/above,
 * gwei→wei), edge-triggering across evaluations, no-data behavior, and
 * persistence round-trip shape checks.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GasOracleState } from '@valve-tech/gas-oracle'

import {
  AlertDirection,
  evaluateAlerts,
  gweiToWei,
  loadRules,
  ruleMatches,
  saveRules,
  type AlertRule,
} from './alerts'

/** Minimal state fixture — only the fields the alert engine reads. */
const makeState = (
  chainId: number,
  fastTipGwei: number,
  blockNumber = 100n,
): GasOracleState => {
  const tip = gweiToWei(fastTipGwei)
  const tier = { maxPriorityFeePerGas: tip, maxFeePerGas: tip * 2n }
  return {
    chainId,
    blockNumber,
    tiers: { slow: tier, standard: tier, fast: tier, instant: tier },
  } as unknown as GasOracleState
}

const rule = (overrides?: Partial<AlertRule>): AlertRule => ({
  id: 'r1',
  chainId: 1,
  tier: 'fast',
  direction: AlertDirection.below,
  thresholdGwei: 2,
  ...overrides,
})

describe('gweiToWei', () => {
  it('converts whole and fractional gwei', () => {
    expect(gweiToWei(2)).toBe(2_000_000_000n)
    expect(gweiToWei(0.5)).toBe(500_000_000n)
  })
})

describe('ruleMatches', () => {
  it('below matches strictly under the threshold', () => {
    expect(ruleMatches(rule(), makeState(1, 1.9))).toBe(true)
    expect(ruleMatches(rule(), makeState(1, 2))).toBe(false)
    expect(ruleMatches(rule(), makeState(1, 2.1))).toBe(false)
  })

  it('above matches strictly over the threshold', () => {
    const r = rule({ direction: AlertDirection.above })
    expect(ruleMatches(r, makeState(1, 2.1))).toBe(true)
    expect(ruleMatches(r, makeState(1, 2))).toBe(false)
  })
})

describe('evaluateAlerts', () => {
  const states = (fastTipGwei: number): Map<number, GasOracleState> =>
    new Map([[1, makeState(1, fastTipGwei)]])

  it('fires on the edge, not while the condition holds', () => {
    const first = evaluateAlerts(states(1), [rule()], new Set(), 1000)
    expect(first.firings).toHaveLength(1)
    expect(first.firings[0].tipWei).toBe(gweiToWei(1))
    expect(first.firings[0].firedAt).toBe(1000)
    expect(first.matching.has('r1')).toBe(true)

    // Still matching next evaluation → no new firing.
    const second = evaluateAlerts(states(1), [rule()], first.matching, 2000)
    expect(second.firings).toHaveLength(0)
    expect(second.matching.has('r1')).toBe(true)
  })

  it('re-fires after the condition clears and returns', () => {
    const armed = evaluateAlerts(states(1), [rule()], new Set(), 0)
    const cleared = evaluateAlerts(states(3), [rule()], armed.matching, 0)
    expect(cleared.firings).toHaveLength(0)
    expect(cleared.matching.size).toBe(0)

    const refired = evaluateAlerts(states(1), [rule()], cleared.matching, 0)
    expect(refired.firings).toHaveLength(1)
  })

  it('a rule for a chain with no state yet does not match', () => {
    const result = evaluateAlerts(
      states(1),
      [rule({ id: 'r2', chainId: 369 })],
      new Set(),
      0,
    )
    expect(result.firings).toHaveLength(0)
    expect(result.matching.size).toBe(0)
  })
})

describe('persistence', () => {
  // Vitest runs in Node — supply a Map-backed localStorage.
  beforeAll(() => {
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips rules and drops malformed entries', () => {
    saveRules([rule()])
    expect(loadRules()).toEqual([rule()])

    localStorage.setItem(
      'multi-chain-gas:alert-rules',
      JSON.stringify([rule({ id: 'ok' }), { id: 'broken' }, 42]),
    )
    expect(loadRules()).toEqual([rule({ id: 'ok' })])

    localStorage.setItem('multi-chain-gas:alert-rules', 'not-json')
    expect(loadRules()).toEqual([])
  })
})
