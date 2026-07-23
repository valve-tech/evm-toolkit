/**
 * Multi-chain coordinator — a thin multiplexer over per-chain
 * `TxTracker` instances (spec §18.3).
 *
 * Design decision (2026-07-02): the coordinator manages **one
 * `TxTracker` per `chainId`** and fans events in/out; it is NOT a
 * cross-chain rewrite of the core. Each chain keeps its own
 * `ChainSource`, its own store, and its own state machine — this file
 * adds no state-machine logic of its own, only routing.
 *
 * Fan-in events are tagged with their `chainId` via the
 * `MultiChainTxEvent` wrapper. The per-chain `TxEvent` envelope is
 * deliberately left untouched — it crosses the store serialization
 * boundary, and widening a persisted type is a breaking change.
 *
 * Source lifecycle stays with the caller, matching `createTxTracker`:
 * `multi.start()` starts the trackers, not the `ChainSource`s.
 */

import { createTxTracker } from './tracker.js'
import type {
  BulkTrackOptions,
  CreateTxTrackerOptions,
  TrackOptions,
  TxSubscription,
  TxTracker,
} from './tracker.js'
import type { Address, Hash, TxEvent, TxStatus } from './events.js'
import type { RawTx } from '@valve-tech/chain-source'

/**
 * Thrown when a coordinator method names a `chainId` that no entry in
 * `chains` registered. A typo'd chain must never look like "no
 * events" — same no-silent-downgrade rule as the rest of the toolkit.
 */
export class UnknownChainIdError extends Error {
  readonly chainId: number

  constructor(chainId: number, known: readonly number[]) {
    super(
      `No tracker is registered for chainId ${String(chainId)}. ` +
        `Registered chainIds: ${known.join(', ')}.`,
    )
    this.name = 'UnknownChainIdError'
    this.chainId = chainId
  }
}

/** One fan-in emission: a per-chain `TxEvent` tagged with its chain. */
export interface MultiChainTxEvent {
  readonly chainId: number
  readonly event: TxEvent
}

/**
 * Handle returned by the coordinator's bulk-track methods. Wraps one
 * per-chain `TxSubscription` per registered chain.
 */
export interface MultiChainTxSubscription {
  /**
   * The underlying per-chain bulk subscriptions, keyed by chainId —
   * the escape hatch for per-chain `events()` iteration or targeted
   * teardown.
   */
  readonly perChain: ReadonlyMap<number, TxSubscription>
  /**
   * Imperative subscription to per-hash events across every chain,
   * tagged with the originating `chainId`. Returns an unsubscribe
   * handle covering all chains.
   */
  subscribe(cb: (event: MultiChainTxEvent) => void): () => void
  /** Stop the bulk subscription on every chain. */
  stop(): void
}

/** Factory options for {@link createMultiChainTracker}. */
export interface CreateMultiChainTrackerOptions {
  /**
   * One `createTxTracker` options entry per chain. `chainId` values
   * must be unique; each entry brings its own `ChainSource` (the
   * per-chain ChainSource invariant) and may carry its own store,
   * thresholds, and `onError`.
   */
  chains: readonly CreateTxTrackerOptions[]
  /**
   * Coordinator-level error sink. Receives the `chainId` alongside
   * the method name so a shared sink can attribute failures. Composes
   * with (never replaces) any per-entry `onError`.
   */
  onError?: (chainId: number, method: string, err: unknown) => void
}

/** Public surface returned by {@link createMultiChainTracker}. */
export interface MultiChainTxTracker {
  /** Start every member tracker. Sources are the caller's to start. */
  start(): void
  /** Stop every member tracker. */
  stop(): void
  /** Resolves when every member tracker's rehydration completed. */
  ready(): Promise<void>
  /** Registered chainIds, in entry order. */
  chainIds(): number[]
  /**
   * The underlying per-chain tracker — the escape hatch to the full
   * single-chain API (`group`, `capabilities`, …).
   * @throws {UnknownChainIdError} if the chainId is not registered.
   */
  tracker(chainId: number): TxTracker
  /** @throws {UnknownChainIdError} if the chainId is not registered. */
  getTxStatus(chainId: number, hash: Hash): TxStatus | null
  /** @throws {UnknownChainIdError} if the chainId is not registered. */
  track(
    chainId: number,
    hash: Hash,
    options?: TrackOptions,
  ): AsyncIterable<TxEvent>
  /** @throws {UnknownChainIdError} if the chainId is not registered. */
  subscribe(
    chainId: number,
    hash: Hash,
    cb: (event: TxEvent) => void,
    options?: TrackOptions,
  ): () => void
  /**
   * Fan-in over every member tracker's event stream, each event
   * tagged with its `chainId`. Returns an unsubscribe handle
   * covering all chains.
   */
  subscribeAll(cb: (event: MultiChainTxEvent) => void): () => void
  /** Track txs sent from `address` on every registered chain. */
  trackFromAddress(
    address: Address,
    options?: BulkTrackOptions,
  ): MultiChainTxSubscription
  /** Track txs sent to `address` on every registered chain. */
  trackToAddress(
    address: Address,
    options?: BulkTrackOptions,
  ): MultiChainTxSubscription
  /** Track txs matching `match` on every registered chain. */
  trackPredicate(
    match: (tx: RawTx) => boolean,
    options?: BulkTrackOptions,
  ): MultiChainTxSubscription
}

/**
 * Create a multi-chain coordinator over one `TxTracker` per chain.
 *
 * The registered chain set is fixed at construction — a coordinator
 * with mutable membership would need rules for orphaned subscriptions
 * that the thin-multiplexer design deliberately avoids. Construct a
 * new coordinator when the chain set changes.
 *
 * @throws {TypeError} if `chains` is empty or contains a duplicate
 *   `chainId`.
 */
export function createMultiChainTracker(
  options: CreateMultiChainTrackerOptions,
): MultiChainTxTracker {
  const { chains, onError } = options

  if (chains.length === 0) {
    throw new TypeError(
      'createMultiChainTracker requires at least one chain entry.',
    )
  }

  const trackers = new Map<number, TxTracker>()
  for (const entry of chains) {
    if (trackers.has(entry.chainId)) {
      throw new TypeError(
        `createMultiChainTracker received duplicate chainId ${String(entry.chainId)}.`,
      )
    }
    const entryOnError = entry.onError
    trackers.set(
      entry.chainId,
      createTxTracker({
        ...entry,
        onError: (method, err) => {
          entryOnError?.(method, err)
          onError?.(entry.chainId, method, err)
        },
      }),
    )
  }

  const get = (chainId: number): TxTracker => {
    const tracker = trackers.get(chainId)
    if (!tracker) throw new UnknownChainIdError(chainId, [...trackers.keys()])
    return tracker
  }

  const fanOutBulk = (
    run: (tracker: TxTracker) => TxSubscription,
  ): MultiChainTxSubscription => {
    const perChain = new Map<number, TxSubscription>()
    for (const [chainId, tracker] of trackers) {
      perChain.set(chainId, run(tracker))
    }
    return {
      perChain,
      subscribe: (cb) => {
        const unsubs = [...perChain].map(([chainId, sub]) =>
          sub.subscribe((event) => cb({ chainId, event })),
        )
        return () => {
          for (const unsub of unsubs) unsub()
        }
      },
      stop: () => {
        for (const sub of perChain.values()) sub.stop()
      },
    }
  }

  return {
    start: () => {
      for (const tracker of trackers.values()) tracker.start()
    },
    stop: () => {
      for (const tracker of trackers.values()) tracker.stop()
    },
    ready: async () => {
      await Promise.all([...trackers.values()].map((t) => t.ready()))
    },
    chainIds: () => [...trackers.keys()],
    tracker: get,
    getTxStatus: (chainId, hash) => get(chainId).getTxStatus(hash),
    track: (chainId, hash, trackOptions) =>
      get(chainId).track(hash, trackOptions),
    subscribe: (chainId, hash, cb, trackOptions) =>
      get(chainId).subscribe(hash, cb, trackOptions),
    subscribeAll: (cb) => {
      const unsubs = [...trackers].map(([chainId, tracker]) =>
        tracker.subscribeAll((event) => cb({ chainId, event })),
      )
      return () => {
        for (const unsub of unsubs) unsub()
      }
    },
    trackFromAddress: (address, bulkOptions) =>
      fanOutBulk((tracker) => tracker.trackFromAddress(address, bulkOptions)),
    trackToAddress: (address, bulkOptions) =>
      fanOutBulk((tracker) => tracker.trackToAddress(address, bulkOptions)),
    trackPredicate: (match, bulkOptions) =>
      fanOutBulk((tracker) => tracker.trackPredicate(match, bulkOptions)),
  }
}
