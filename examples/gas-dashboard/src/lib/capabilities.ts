/**
 * Pure capability → panel-enabled decisions. The teaching core of the demo:
 * chain-source probes the RPC, this maps the probe onto what the UI can show.
 * No silent downgrade — every disabled panel gets an explanation string.
 */
import type { Capabilities } from '@valve-tech/chain-source'

export type Transport = 'ws' | 'http-poll'
export type BlockPositionMode = 'mempool' | 'block-included'

export interface Badge {
  id: 'http' | 'ws' | 'mempool'
  label: string
  on: boolean
  detail: string
}

export interface PanelState {
  /** Mempool histogram panel is live (txpool_content available). */
  mempoolEnabled: boolean
  /** Why the histogram is off, for the degradation notice. '' when on. */
  mempoolReason: string
  /** Block-position estimator distribution source. */
  blockPositionMode: BlockPositionMode
  /** How blocks arrive — push subscription vs interval poll. */
  transport: Transport
  badges: Badge[]
}

export const derivePanelState = (caps: Capabilities): PanelState => {
  const mempoolEnabled = caps.txpoolContent === 'available'
  const transport: Transport = caps.newHeads === 'subscription' ? 'ws' : 'http-poll'

  return {
    mempoolEnabled,
    mempoolReason: mempoolEnabled
      ? ''
      : "this RPC doesn't expose the mempool (txpool_content is gated)",
    blockPositionMode: mempoolEnabled ? 'mempool' : 'block-included',
    transport,
    badges: [
      {
        id: 'http',
        label: 'HTTP',
        on: true,
        detail: 'JSON-RPC over HTTP — always available',
      },
      {
        id: 'ws',
        label: 'WS',
        on: transport === 'ws',
        detail:
          transport === 'ws'
            ? 'eth_subscribe(newHeads) is live — push updates'
            : 'no working subscription — polling on the interval timer',
      },
      {
        id: 'mempool',
        label: 'mempool',
        on: mempoolEnabled,
        detail: mempoolEnabled
          ? 'txpool_content available — live pending-tx tips'
          : 'txpool_content gated — histogram falls back to recent block tips',
      },
    ],
  }
}
