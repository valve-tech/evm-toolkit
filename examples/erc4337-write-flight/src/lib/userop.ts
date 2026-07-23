/**
 * Pure UserOperation helpers — the phase vocabulary for the AA write
 * path and the gas-oracle → UserOp fee mapping. No I/O; tested with
 * literal fixtures.
 */
import type { GasOracleState, TierName } from '@valve-tech/gas-oracle'

/**
 * Lifecycle phases of one UserOperation, in order. Deliberately local
 * to this example — `@valve-tech/wallet-adapter`'s hook vocabulary
 * describes EOA sends (hash at signature time); a UserOp gets its
 * inclusion tx hash only when the bundler's batch lands, so the
 * phases differ structurally.
 */
export const UserOpPhase = {
  idle: 'idle',
  preparing: 'preparing',
  signing: 'signing',
  submitted: 'submitted',
  bundled: 'bundled',
  failed: 'failed',
} as const
export type UserOpPhase = (typeof UserOpPhase)[keyof typeof UserOpPhase]

/** Ordered ladder for rendering a phase timeline. */
export const USER_OP_PHASE_LADDER: readonly UserOpPhase[] = [
  UserOpPhase.preparing,
  UserOpPhase.signing,
  UserOpPhase.submitted,
  UserOpPhase.bundled,
]

/** EIP-1559 fee pair for a UserOperation. */
export interface UserOpFees {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}

/**
 * Price a UserOperation from a gas-oracle tier. The UserOp's fee
 * fields are the same EIP-1559 pair an EOA tx carries — the oracle's
 * per-tier recommendation applies directly. Returns null when the
 * oracle hasn't produced a state yet (callers fall back to the
 * bundler's own estimate rather than guessing).
 */
export const feesFromTier = (
  state: GasOracleState | null,
  tier: TierName,
): UserOpFees | null => {
  if (!state) return null
  const t = state.tiers[tier]
  return {
    maxFeePerGas: t.maxFeePerGas,
    maxPriorityFeePerGas: t.maxPriorityFeePerGas,
  }
}

/** True once `phase` is at or past `milestone` on the ladder. */
export const phaseReached = (
  phase: UserOpPhase,
  milestone: UserOpPhase,
): boolean => {
  if (phase === UserOpPhase.failed || phase === UserOpPhase.idle) return false
  return (
    USER_OP_PHASE_LADDER.indexOf(phase) >=
    USER_OP_PHASE_LADDER.indexOf(milestone)
  )
}
