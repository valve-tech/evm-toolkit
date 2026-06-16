import { describe, it, expect } from 'vitest'
import type { Capabilities } from '@valve-tech/chain-source'
import { derivePanelState } from './capabilities'

const caps = (over: Partial<Capabilities> = {}): Capabilities => ({
  newHeads: 'poll-only',
  newPendingTransactions: 'poll-only',
  txpoolContent: 'gated',
  receiptByHash: 'available',
  reprobeOnReconnect: false,
  ...over,
})

describe('derivePanelState', () => {
  it('gated txpool → histogram disabled, estimator falls back to block tips', () => {
    const p = derivePanelState(caps({ txpoolContent: 'gated' }))
    expect(p.mempoolEnabled).toBe(false)
    expect(p.blockPositionMode).toBe('block-included')
    expect(p.badges.find((b) => b.id === 'mempool')?.on).toBe(false)
  })

  it('available txpool → histogram enabled, estimator uses mempool+ring', () => {
    const p = derivePanelState(caps({ txpoolContent: 'available' }))
    expect(p.mempoolEnabled).toBe(true)
    expect(p.blockPositionMode).toBe('mempool')
    expect(p.badges.find((b) => b.id === 'mempool')?.on).toBe(true)
  })

  it('newHeads subscription → ws transport badge on', () => {
    const p = derivePanelState(caps({ newHeads: 'subscription' }))
    expect(p.transport).toBe('ws')
    expect(p.badges.find((b) => b.id === 'ws')?.on).toBe(true)
    expect(p.badges.find((b) => b.id === 'http')?.on).toBe(true)
  })

  it('newHeads poll-only → http poll transport, ws badge off', () => {
    const p = derivePanelState(caps({ newHeads: 'poll-only' }))
    expect(p.transport).toBe('http-poll')
    expect(p.badges.find((b) => b.id === 'ws')?.on).toBe(false)
  })
})
