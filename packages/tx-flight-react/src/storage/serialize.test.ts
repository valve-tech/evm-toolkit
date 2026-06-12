import { test, expect } from 'vitest'
import type { TrackedTx } from '@valve-tech/wallet-adapter'

import { serialize, deserialize } from './serialize.js'

const sample = (overrides: Partial<TrackedTx> = {}): TrackedTx => ({
  id: 'tx-1',
  chainId: 1,
  flow: 'send',
  submittedAt: 1_000_000,
  submittedTier: 'standard',
  status: 'pending',
  ...overrides,
})

test('round-trips a TrackedTx without bigint fields', () => {
  const original = [sample()]
  const out = deserialize(serialize(original))
  expect(out).toEqual(original)
})

test('round-trips bigint fields under submittedGas as 0x-hex strings', () => {
  const original = [
    sample({
      submittedGas: {
        maxFeePerGas: 1234567890123456789n,
        maxPriorityFeePerGas: 987n,
      },
    }),
  ]
  const out = deserialize(serialize(original))
  expect(out[0]?.submittedGas?.maxFeePerGas).toBe(1234567890123456789n)
  expect(out[0]?.submittedGas?.maxPriorityFeePerGas).toBe(987n)
})

test('preserves all optional fields across the round trip', () => {
  const original = [
    sample({
      hash: '0xabc',
      confirmedAt: 2_000_000,
      replacedBy: '0xnewhash',
      replaces: '0xoldhash',
      notes: 'cancelled in wallet',
      status: 'failed',
    }),
  ]
  const out = deserialize(serialize(original))
  expect(out).toEqual(original)
})

test('serializes an empty array round-trip', () => {
  expect(deserialize(serialize([]))).toEqual([])
})

/**
 * Build a `TrackedTx`-shaped object with arbitrary fields omitted —
 * simulates a record persisted by an earlier toolkit version that
 * didn't yet have those fields. Cast through `unknown` is the "this
 * is wire data, not in-memory data" signal; see
 * `feedback_persisted_type_evolution.md` in project memory for the
 * full wire-shape evolution discipline.
 *
 * Mirrors `makeLegacyTxStatus` in `tx-tracker/src/tracker.test.ts`.
 * If you add a new field to `TrackedTx`, also (a) update the
 * `persisted-types.manifest.json` entry, (b) make the field
 * optional or write a migration, and (c) write at least one test
 * here that omits the field and exercises the serialize /
 * deserialize round trip against the legacy shape.
 */
const makeLegacyTrackedTx = (
  overrides: Partial<TrackedTx> = {},
  omit: (keyof TrackedTx)[] = [],
): TrackedTx => {
  const base: Record<string, unknown> = {
    id: 'tx-legacy',
    chainId: 1,
    flow: 'send',
    submittedAt: 1_000_000,
    submittedTier: 'standard',
    status: 'pending',
    ...overrides,
  }
  for (const field of omit) delete base[field as string]
  return base as unknown as TrackedTx
}

test('legacy-fixture: a TrackedTx persisted before submittedTier existed round-trips without crashing', () => {
  // submittedTier has been on TrackedTx since v0.4.0 and is
  // non-optional. Records persisted by anyone older would lack it.
  // This test exercises the wire-shape evolution discipline: the
  // serializer must accept the legacy record (no submittedTier),
  // and the deserialized output is structurally identical (just
  // with submittedTier still absent).
  const legacy = [makeLegacyTrackedTx({}, ['submittedTier'])]
  const round = deserialize(serialize(legacy))
  expect(round[0].id).toBe('tx-legacy')
  expect(round[0].submittedTier).toBeUndefined()
})

test('legacy-fixture: a TrackedTx without submittedGas round-trips (most common pre-v0.5 shape)', () => {
  // submittedGas is optional (`?:`), so this is the happy path —
  // already legacy-safe by type. Locks the behavior in.
  const legacy = [makeLegacyTrackedTx()]
  const round = deserialize(serialize(legacy))
  expect(round[0].submittedGas).toBeUndefined()
  expect(round[0].id).toBe('tx-legacy')
})

test('serialize/deserialize are re-exported from the /storage public surface', async () => {
  // Consumers persisting TrackedTx through their own storage layer
  // need the bigint-safe codec without reaching into package
  // internals. Locks the subpath export so the integration skill's
  // guidance stays true.
  const surface = await import('./index.js')
  expect(surface.serialize).toBe(serialize)
  expect(surface.deserialize).toBe(deserialize)
})
