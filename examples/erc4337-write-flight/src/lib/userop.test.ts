import { describe, expect, it } from 'vitest'
import type { GasOracleState } from '@valve-tech/gas-oracle'

import {
  UserOpPhase,
  feesFromTier,
  phaseReached,
} from './userop'

const state = (): GasOracleState => {
  const tier = (tip: bigint) => ({
    maxPriorityFeePerGas: tip,
    maxFeePerGas: tip * 3n,
  })
  return {
    tiers: {
      slow: tier(1n),
      standard: tier(2n),
      fast: tier(5n),
      instant: tier(9n),
    },
  } as unknown as GasOracleState
}

describe('feesFromTier', () => {
  it('maps the tier recommendation onto the UserOp fee pair', () => {
    expect(feesFromTier(state(), 'fast')).toEqual({
      maxPriorityFeePerGas: 5n,
      maxFeePerGas: 15n,
    })
  })

  it('is null without oracle state — callers use the bundler estimate', () => {
    expect(feesFromTier(null, 'fast')).toBeNull()
  })
})

describe('phaseReached', () => {
  it('walks the ladder in order', () => {
    expect(phaseReached(UserOpPhase.submitted, UserOpPhase.signing)).toBe(true)
    expect(phaseReached(UserOpPhase.signing, UserOpPhase.submitted)).toBe(false)
    expect(phaseReached(UserOpPhase.bundled, UserOpPhase.bundled)).toBe(true)
  })

  it('failed and idle reach no milestone', () => {
    expect(phaseReached(UserOpPhase.failed, UserOpPhase.preparing)).toBe(false)
    expect(phaseReached(UserOpPhase.idle, UserOpPhase.preparing)).toBe(false)
  })
})
