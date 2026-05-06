/**
 * `waitForPending` — Promise that resolves when a tx hash is first
 * observed in any mempool. Rejects with `WaitForPendingTimeoutError`
 * if `timeoutBlocks` elapses without observation.
 *
 * Surfaces the "submitted but never arrived" failure mode explicitly:
 * when an RPC accepts a transaction but the tx never appears in any
 * observed mempool, this helper times out rather than hanging.
 *
 * Internally constructs a private ChainSource + TxTracker (or accepts
 * a `_sourceOverride` for tests) and tears them down before settling.
 */

import type { PublicClient } from 'viem'
import type { ChainSource } from '@valve-tech/chain-source'
import { createChainSource } from '@valve-tech/chain-source'

import type { Hash, TxEventSeenInMempool } from './events.js'
import { createTxTracker } from './tracker.js'

export class WaitForPendingTimeoutError extends Error {
  readonly hash: Hash
  readonly observedBlocks: number
  constructor(hash: Hash, observedBlocks: number) {
    super(
      `waitForPending: hash ${hash} not observed in any mempool after ${observedBlocks} block(s)`,
    )
    this.name = 'WaitForPendingTimeoutError'
    this.hash = hash
    this.observedBlocks = observedBlocks
  }
}

export interface WaitForPendingOptions {
  client: PublicClient
  hash: Hash
  /**
   * Reject with WaitForPendingTimeoutError if the hash isn't observed
   * in any mempool within this many block ticks. Default 12.
   */
  timeoutBlocks?: number
  pollIntervalMs?: number
  onError?: (method: string, err: unknown) => void
}

/**
 * @internal
 * Test-injection seam — same shape as the other helpers' seams.
 * Not re-exported from index.ts.
 */
export interface WaitForPendingInternalOptions extends WaitForPendingOptions {
  _sourceOverride?: ChainSource
}

export const waitForPending = (
  options: WaitForPendingOptions,
): Promise<TxEventSeenInMempool> => {
  const internalOptions = options as WaitForPendingInternalOptions
  const timeoutBlocks = options.timeoutBlocks ?? 12

  return new Promise<TxEventSeenInMempool>((resolve, reject) => {
    const source: ChainSource =
      internalOptions._sourceOverride ??
      createChainSource({
        client: options.client,
        pollIntervalMs: options.pollIntervalMs,
        onError: options.onError,
      })
    const tracker = createTxTracker({
      source,
      chainId: 0,
      onError: options.onError,
    })

    const ownsSource = !internalOptions._sourceOverride
    if (ownsSource) source.start()
    tracker.start()

    let teardownSubscribe: (() => void) | null = null
    let teardownBlocks: (() => void) | null = null
    let observedBlocks = 0
    let settled = false

    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      teardownSubscribe?.()
      teardownBlocks?.()
      tracker.stop()
      if (ownsSource) source.stop()
      action()
    }

    teardownSubscribe = tracker.subscribe(
      options.hash,
      (event) => {
        if (settled) return
        if (event.kind === 'seen-in-mempool') {
          finish(() => resolve(event))
        }
      },
      { emitInitial: false },
    )

    teardownBlocks = source.subscribeBlocks(() => {
      if (settled) return
      observedBlocks++
      if (observedBlocks >= timeoutBlocks) {
        const err = new WaitForPendingTimeoutError(options.hash, observedBlocks)
        finish(() => reject(err))
      }
    })
  })
}
