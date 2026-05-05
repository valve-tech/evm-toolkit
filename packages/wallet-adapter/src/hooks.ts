/**
 * @fileoverview Per-call lifecycle hooks for any SDK method that opens a
 * wallet popup, awaits inclusion, and may later observe replacement or
 * mempool drop.
 *
 * The contract describes EVERY phase a tracked tx can be in. Different
 * fire-ers cover different slices:
 *
 *   - `sendTransactionWithHooks` fires the wallet-side phases
 *     (`awaiting-signature`, `pending`, plus `failed` on rejection /
 *     wallet-side network error).
 *   - `awaitReceiptWithHooks` fires the chain-side terminal phases
 *     (`confirmed` or `failed` on revert / receipt-await error).
 *   - `@valve-tech/tx-tracker` (per-tx state machine, observes across
 *     blocks) fires `dropped` and `replaced` once it ships, plus may
 *     re-emit transitions if a tx surfaces / vanishes / surfaces again
 *     across reorgs.
 *   - The SDK itself may fire `preparing` at the very start of its
 *     write method, before any pre-wallet work begins.
 *
 * Two shapes are available — complementary, not alternatives:
 *
 *   - **Named hooks** (`onAwaitingSignature`, `onConfirmed`, etc.) —
 *     ergonomic, easy to wire from a hook-like API, narrow types per
 *     callback.
 *   - **`onPhase(event)`** — single-callback discriminated union.
 *     Better for state-machine consumers that need a single transition
 *     point and exhaustive `switch`-coverage on the phase name.
 *
 * Fire-ers fire BOTH shapes for every transition — exactly once each —
 * so consumers can choose which to wire without affecting the other.
 */

import type { Hex, TransactionReceipt } from 'viem'

/**
 * Every lifecycle phase a tracked transaction can be in, from intent
 * through terminal observation. Carriers (helpers, trackers, SDKs)
 * fire transitions in roughly this order, though `dropped` and
 * `replaced` may arrive late or interleave with re-emissions on reorg.
 */
export type WritePhase =
  | 'preparing'
  | 'awaiting-signature'
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'dropped'
  | 'replaced'

/**
 * Discriminated-union event payload for the `onPhase` callback. Switch
 * on `event.phase` and TypeScript narrows the rest of the fields
 * automatically — no `event.context?.receipt` indirection.
 */
export type WritePhaseEvent =
  | { phase: 'preparing' }
  | { phase: 'awaiting-signature' }
  | { phase: 'pending'; hash: Hex }
  | { phase: 'confirmed'; hash: Hex; receipt: TransactionReceipt }
  | { phase: 'failed'; error: Error; hash?: Hex; receipt?: TransactionReceipt }
  | { phase: 'dropped'; hash: Hex }
  | { phase: 'replaced'; original: Hex; replacement: Hex; receipt?: TransactionReceipt }

/**
 * Per-call hooks fired at real boundaries during a tracked tx's
 * lifecycle. Every field is optional. SDKs and trackers fire whichever
 * subset corresponds to phases they actually observe; consumers wire
 * only the ones their UI needs.
 *
 * Named hooks vs `onPhase`: complementary, not alternatives. A
 * fire-er fires both for every transition — the named hook (if a
 * consumer wired it) and `onPhase` (if a consumer wired it) — so no
 * transition is observable from one shape but not the other.
 */
export interface WriteHookParams {
  /**
   * Called once, immediately before `wallet.sendTransaction`. UI flips
   * from "preparing" to "awaiting wallet signature" at the precise
   * boundary, regardless of how much pre-wallet work the SDK did.
   */
  onAwaitingSignature?: () => void
  /**
   * Called once with the on-chain tx hash, immediately after
   * `sendTransaction` resolves and *before* any receipt-await. UI flips
   * from "awaiting" to "pending" the moment the hash exists.
   *
   * Per-call vs constructor-level: SDKs may also expose a separate
   * constructor-level `onTransactionHash` channel for analytics /
   * global observers — they're complementary, fire on the same line.
   */
  onTransactionHash?: (hash: Hex) => void
  /**
   * Called once with the mined receipt when `receipt.status === 'success'`.
   * UI flips to a terminal "confirmed" state. Receives the full receipt
   * so consumers can extract block number, gas used, decoded events.
   */
  onConfirmed?: (receipt: TransactionReceipt) => void
  /**
   * Called once with the underlying error on any terminal failure that
   * is NOT a replacement or a drop:
   *   - wallet rejection (`WalletRejectedError`)
   *   - on-chain revert (`ContractRevertedError`)
   *   - any other thrown error from the wallet or RPC.
   *
   * Use `instanceof` against `WalletRejectedError` / `ContractRevertedError`
   * to discriminate; everything else is a plain `Error`.
   */
  onFailed?: (error: Error) => void
  /**
   * Called once when a tracker has determined the tx will not be
   * included — typically: not seen in mempool for N consecutive blocks
   * AND no receipt arrived AND no replacement nonce mined. The exact
   * timeout policy is the tracker's call (configurable per consumer).
   *
   * Helpers in THIS package never fire `onDropped` — distinguishing
   * "still propagating" from "permanently dropped" requires multi-block
   * observation. Wire this against a `tx-tracker` instance, not against
   * `awaitReceiptWithHooks`.
   */
  onDropped?: (info: { hash: Hex }) => void
  /**
   * Called once when a tracker observes that a *different* tx with the
   * same nonce mined in place of the one we were watching — typically
   * the user's own speed-up / cancel from their wallet, or a
   * fee-replacement broadcast separately.
   *
   * `replacement.receipt` is included when the replacement has been
   * mined; trackers may emit `replaced` with no receipt if they only
   * saw the replacement in the mempool.
   */
  onReplaced?: (info: { original: Hex; replacement: Hex; receipt?: TransactionReceipt }) => void
  /**
   * Single-callback complement to the named hooks. Fires for every
   * lifecycle transition with a discriminated-union payload. Useful
   * for state-machine consumers that prefer one transition point and
   * exhaustive `switch`-coverage over wiring six separate callbacks.
   *
   * Fire-ers fire BOTH `onPhase` and the matching named hook on each
   * transition — exactly once each — so wiring one shape doesn't
   * preclude the other.
   */
  onPhase?: (event: WritePhaseEvent) => void
}
