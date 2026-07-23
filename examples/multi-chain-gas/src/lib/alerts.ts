/**
 * Threshold alert rules — all pure. A rule watches one tier on one chain
 * and matches while the tier's tip is below/above a gwei threshold.
 *
 * Alerts are EDGE-TRIGGERED: a firing is reported only on the transition
 * from not-matching to matching, so a rule that stays satisfied for fifty
 * consecutive blocks notifies once, not fifty times. The caller carries the
 * previous matching-rule-id set between evaluations.
 *
 * localStorage persistence for rules lives here too (plain JSON — rules
 * hold only strings and numbers, no bigints cross this boundary).
 */
import type { GasOracleState, TierName } from '@valve-tech/gas-oracle'

export const AlertDirection = {
  below: 'below',
  above: 'above',
} as const
export type AlertDirection =
  (typeof AlertDirection)[keyof typeof AlertDirection]

export interface AlertRule {
  /** Stable id — also the key for edge-trigger memory. */
  id: string
  chainId: number
  tier: TierName
  direction: AlertDirection
  /** Threshold in gwei (fractional ok, e.g. 0.5). */
  thresholdGwei: number
}

/** One edge-triggered alert firing. */
export interface AlertFiring {
  rule: AlertRule
  /** The tier tip (wei) that crossed the threshold. */
  tipWei: bigint
  blockNumber: bigint
  /** ms-epoch of evaluation, supplied by the caller (pure function). */
  firedAt: number
}

export interface AlertEvaluation {
  /** Rules that crossed from not-matching to matching this evaluation. */
  firings: AlertFiring[]
  /** All currently-matching rule ids — feed back into the next call. */
  matching: Set<string>
}

const GWEI = 1_000_000_000

/** Convert a (possibly fractional) gwei number to wei. */
export const gweiToWei = (gwei: number): bigint =>
  BigInt(Math.round(gwei * GWEI))

/** Does `rule` match against `state` right now? */
export const ruleMatches = (
  rule: AlertRule,
  state: GasOracleState,
): boolean => {
  const tip = state.tiers[rule.tier].maxPriorityFeePerGas
  const threshold = gweiToWei(rule.thresholdGwei)
  return rule.direction === AlertDirection.below
    ? tip < threshold
    : tip > threshold
}

/**
 * Evaluate every rule against the current per-chain states. Rules whose
 * chain has no state yet simply don't match (no data ≠ matching).
 */
export const evaluateAlerts = (
  states: ReadonlyMap<number, GasOracleState>,
  rules: readonly AlertRule[],
  previouslyMatching: ReadonlySet<string>,
  now: number,
): AlertEvaluation => {
  const matching = new Set<string>()
  const firings: AlertFiring[] = []

  for (const rule of rules) {
    const state = states.get(rule.chainId)
    if (!state) continue
    if (!ruleMatches(rule, state)) continue
    matching.add(rule.id)
    if (previouslyMatching.has(rule.id)) continue
    firings.push({
      rule,
      tipWei: state.tiers[rule.tier].maxPriorityFeePerGas,
      blockNumber: state.blockNumber,
      firedAt: now,
    })
  }

  return { firings, matching }
}

// ---------------------------------------------------------------------------
// Persistence — plain JSON in localStorage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'multi-chain-gas:alert-rules'

/** Shape-check one parsed candidate; drop anything malformed. */
const isRule = (value: unknown): value is AlertRule => {
  if (value === null || typeof value !== 'object') return false
  const rule = value as Partial<AlertRule>
  return (
    typeof rule.id === 'string' &&
    typeof rule.chainId === 'number' &&
    typeof rule.tier === 'string' &&
    (rule.direction === AlertDirection.below ||
      rule.direction === AlertDirection.above) &&
    typeof rule.thresholdGwei === 'number' &&
    Number.isFinite(rule.thresholdGwei)
  )
}

export const loadRules = (): AlertRule[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRule)
  } catch {
    return []
  }
}

export const saveRules = (rules: readonly AlertRule[]): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
}
