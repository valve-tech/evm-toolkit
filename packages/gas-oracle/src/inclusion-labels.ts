/**
 * Default English UI copy mapping each tier to a user-facing inclusion
 * label, plus a small helper that resolves a tier with optional partial
 * overrides (locale or branded copy without forking the whole map).
 *
 * Conservative phrasing — labels describe relative position in the next
 * block, not hard guarantees. Real inclusion is probabilistic.
 */

import { TierName } from './types.js'

export const defaultInclusionLabels: Record<TierName, string> = {
  [TierName.slow]: 'Within a few blocks',
  [TierName.standard]: 'Next block',
  [TierName.fast]: 'Top of next block',
  [TierName.instant]: 'Front of next block',
}

/**
 * Resolve a tier to its inclusion label, falling back to
 * `defaultInclusionLabels` for any tier not present in `overrides`.
 *
 * Locale / branded-copy pattern (no fork required):
 *
 * ```ts
 * const es: Partial<Record<TierName, string>> = {
 *   [TierName.standard]: 'Próximo bloque',
 *   [TierName.fast]: 'Cabeza del próximo bloque',
 * }
 * inclusionLabel(TierName.standard, es) // 'Próximo bloque'
 * inclusionLabel(TierName.slow, es)     // falls back to default English
 * ```
 *
 * Consumers can also fully replace the map by spreading:
 * `const myLabels = { ...defaultInclusionLabels, ...partial }`.
 */
export const inclusionLabel = (
  tier: TierName,
  overrides?: Partial<Record<TierName, string>>,
): string => overrides?.[tier] ?? defaultInclusionLabels[tier]
