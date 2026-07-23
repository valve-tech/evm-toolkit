/**
 * Tests for `createMultiChainTracker` — the thin multiplexer over
 * per-chain `TxTracker` instances (spec §18.3).
 *
 * Fixtures:
 *   1. Constructor validation — empty chains, duplicate chainIds
 *   2. Delegation — track / subscribe / getTxStatus route to the
 *      tracker owning that chainId, and only that one
 *   3. Fan-in — subscribeAll tags every event with its chainId
 *   4. Fan-out — trackFromAddress / trackToAddress / trackPredicate
 *      cover every chain; combined subscribe tags per-hash events;
 *      stop() tears down every per-chain bulk subscription
 *   5. Error surfaces — UnknownChainIdError on a miss; coordinator
 *      onError receives (chainId, method, err) and composes with the
 *      per-entry onError rather than replacing it
 *   6. Lifecycle — start/stop fan out, ready() awaits every member
 */

import { test, expect } from 'vitest'

import type {
  BlockResult,
  Capabilities,
  ChainSource,
  FeeHistoryResult,
  NormalizedMempool,
  RawTx,
  TransactionReceipt,
} from '@valve-tech/chain-source'

import {
  createMultiChainTracker,
  UnknownChainIdError,
  type MultiChainTxEvent,
} from './multi-tracker.js'
import type { TxEvent } from './events.js'

// ---------------------------------------------------------------------------
// Stub ChainSource (mirrors tracker.test.ts helpers)
// ---------------------------------------------------------------------------

interface StubSource extends ChainSource {
  emitBlock(block: BlockResult): void
  emitMempool(snapshot: NormalizedMempool): void
  startCalls: number
  stopCalls: number
}

const DEFAULT_CAPS: Capabilities = {
  newHeads: 'subscription',
  newPendingTransactions: 'poll-only',
  txpoolContent: 'available',
  receiptByHash: 'available',
  reprobeOnReconnect: true,
}

const makeSource = (): StubSource => {
  const blockSubs = new Set<(b: BlockResult) => void>()
  const mempoolSubs = new Set<(s: NormalizedMempool) => void>()

  const stub: StubSource = {
    startCalls: 0,
    stopCalls: 0,
    start: () => {},
    stop: () => {},
    pollOnce: async () => {},
    ready: () => Promise.resolve(),
    subscribeBlocks: (cb) => {
      blockSubs.add(cb)
      return () => blockSubs.delete(cb)
    },
    subscribeMempool: (cb) => {
      mempoolSubs.add(cb)
      return () => mempoolSubs.delete(cb)
    },
    getBlock: async (): Promise<BlockResult | null> => null,
    getBlockByHash: async (): Promise<BlockResult | null> => null,
    getFeeHistory: async (): Promise<FeeHistoryResult | null> => null,
    getMempoolSnapshot: async (): Promise<NormalizedMempool | null> => null,
    getReceipt: async (): Promise<TransactionReceipt | null> => null,
    getTransaction: async (): Promise<RawTx | null> => null,
    capabilities: () => DEFAULT_CAPS,
    emitBlock: (block) => {
      for (const cb of [...blockSubs]) cb(block)
    },
    emitMempool: (snapshot) => {
      for (const cb of [...mempoolSubs]) cb(snapshot)
    },
  }
  return stub
}

const makeBlock = (
  number: bigint,
  hash: string,
  txs: RawTx[],
  parentHash: string = '0xparent',
): BlockResult => ({
  number: '0x' + number.toString(16),
  hash,
  parentHash,
  timestamp: '0x' + (number * 12n).toString(16),
  baseFeePerGas: '0x0',
  gasLimit: '0x0',
  gasUsed: '0x0',
  transactions: txs,
})

/** Two-chain coordinator over independent stub sources. */
const makePair = (onError?: (c: number, m: string, e: unknown) => void) => {
  const sourceA = makeSource()
  const sourceB = makeSource()
  const multi = createMultiChainTracker({
    chains: [
      { source: sourceA, chainId: 1 },
      { source: sourceB, chainId: 369 },
    ],
    onError,
  })
  multi.start()
  return { multi, sourceA, sourceB }
}

// ---------------------------------------------------------------------------
// 1. Constructor validation
// ---------------------------------------------------------------------------

test('throws TypeError when chains is empty', () => {
  expect(() => createMultiChainTracker({ chains: [] })).toThrow(TypeError)
})

test('throws TypeError on duplicate chainIds', () => {
  const source = makeSource()
  expect(() =>
    createMultiChainTracker({
      chains: [
        { source, chainId: 1 },
        { source: makeSource(), chainId: 1 },
      ],
    }),
  ).toThrow(TypeError)
})

test('chainIds() lists every registered chain in entry order', () => {
  const { multi } = makePair()
  expect(multi.chainIds()).toEqual([1, 369])
  multi.stop()
})

// ---------------------------------------------------------------------------
// 2. Delegation routes to the owning chain only
// ---------------------------------------------------------------------------

test('subscribe(chainId) sees blocks from that chain only', () => {
  const { multi, sourceA, sourceB } = makePair()
  const events: TxEvent[] = []
  multi.subscribe(1, '0xaaa', (e) => events.push(e), { emitInitial: false })

  // A block containing the hash on the OTHER chain must not leak over.
  sourceB.emitBlock(
    makeBlock(50n, '0xotherchain', [
      { hash: '0xaaa', from: '0xs', nonce: '0x1' },
    ]),
  )
  expect(events).toHaveLength(0)

  sourceA.emitBlock(
    makeBlock(100n, '0xb1', [{ hash: '0xaaa', from: '0xs', nonce: '0x1' }]),
  )
  expect(events.some((e) => e.kind === 'seen-in-block')).toBe(true)
  multi.stop()
})

test('getTxStatus(chainId) reflects only that chain', () => {
  const { multi, sourceA } = makePair()
  multi.subscribe(1, '0xaaa', () => {}, { emitInitial: false })
  sourceA.emitBlock(
    makeBlock(100n, '0xb1', [{ hash: '0xaaa', from: '0xs', nonce: '0x1' }]),
  )
  expect(multi.getTxStatus(1, '0xaaa')?.lastSeenInBlock).not.toBeNull()
  expect(multi.getTxStatus(369, '0xaaa')).toBeNull()
  multi.stop()
})

test('track(chainId) yields events from the owning chain', async () => {
  const { multi, sourceA } = makePair()
  const iterator = multi.track(1, '0xaaa', { emitInitial: true })

  const first = (async () => {
    for await (const event of iterator) return event
    return null
  })()
  const event = await first
  expect(event?.kind).toBe('started')
  multi.stop()
  void sourceA
})

test('tracker(chainId) exposes the underlying instance', () => {
  const { multi } = makePair()
  expect(multi.tracker(1).getTxStatus('0xnope')).toBeNull()
  multi.stop()
})

// ---------------------------------------------------------------------------
// 3. subscribeAll fan-in tags events with chainId
// ---------------------------------------------------------------------------

test('subscribeAll receives events from every chain, tagged', () => {
  const { multi, sourceA, sourceB } = makePair()
  const seen: MultiChainTxEvent[] = []
  const unsubscribe = multi.subscribeAll((e) => seen.push(e))

  multi.subscribe(1, '0xaaa', () => {}, { emitInitial: false })
  multi.subscribe(369, '0xbbb', () => {}, { emitInitial: false })
  sourceA.emitBlock(
    makeBlock(100n, '0xb1', [{ hash: '0xaaa', from: '0xs', nonce: '0x1' }]),
  )
  sourceB.emitBlock(
    makeBlock(200n, '0xb2', [{ hash: '0xbbb', from: '0xs', nonce: '0x1' }]),
  )

  const chainsSeen = new Set(seen.map((e) => e.chainId))
  expect(chainsSeen.has(1)).toBe(true)
  expect(chainsSeen.has(369)).toBe(true)
  for (const e of seen.filter((x) => x.event.kind === 'seen-in-block')) {
    expect(e.event.hash).toBe(e.chainId === 1 ? '0xaaa' : '0xbbb')
  }

  unsubscribe()
  const countAtUnsub = seen.length
  sourceA.emitBlock(
    makeBlock(101n, '0xb3', [{ hash: '0xaaa', from: '0xs', nonce: '0x1' }]),
  )
  expect(seen).toHaveLength(countAtUnsub)
  multi.stop()
})

// ---------------------------------------------------------------------------
// 4. Bulk fan-out
// ---------------------------------------------------------------------------

test('trackFromAddress fans out to every chain and tags per-hash events', () => {
  const { multi, sourceA, sourceB } = makePair()
  const bulk = multi.trackFromAddress('0xsender')
  expect([...bulk.perChain.keys()]).toEqual([1, 369])

  const seen: MultiChainTxEvent[] = []
  bulk.subscribe((e) => seen.push(e))

  sourceA.emitBlock(
    makeBlock(100n, '0xb1', [
      { hash: '0xa1', from: '0xsender', nonce: '0x1' },
    ]),
  )
  sourceB.emitBlock(
    makeBlock(200n, '0xb2', [
      { hash: '0xa2', from: '0xsender', nonce: '0x1' },
    ]),
  )

  const chains = new Set(seen.map((e) => e.chainId))
  expect(chains.has(1)).toBe(true)
  expect(chains.has(369)).toBe(true)

  bulk.stop()
  multi.stop()
})

test('trackToAddress fans out to every chain', () => {
  const { multi, sourceA } = makePair()
  const bulk = multi.trackToAddress('0xrecipient')
  const seen: MultiChainTxEvent[] = []
  bulk.subscribe((e) => seen.push(e))

  sourceA.emitBlock(
    makeBlock(100n, '0xb1', [
      // RawTx at chain-source carries `to` loosely — the matcher
      // reads it via the structurally-typed object so this works.
      { hash: '0xt1', from: '0xs', to: '0xrecipient', nonce: '0x1' } as never,
    ]),
  )
  expect(seen.some((e) => e.chainId === 1)).toBe(true)
  bulk.stop()
  multi.stop()
})

test('trackPredicate fans out to every chain', () => {
  const { multi, sourceB } = makePair()
  const bulk = multi.trackPredicate((tx) => tx.hash === '0xwanted')
  const seen: MultiChainTxEvent[] = []
  bulk.subscribe((e) => seen.push(e))

  sourceB.emitBlock(
    makeBlock(200n, '0xb2', [{ hash: '0xwanted', from: '0xs', nonce: '0x1' }]),
  )
  expect(seen.some((e) => e.chainId === 369)).toBe(true)
  bulk.stop()
  multi.stop()
})

test('combined bulk subscribe unsubscribes cleanly', () => {
  const { multi, sourceA } = makePair()
  const bulk = multi.trackFromAddress('0xsender')
  const seen: MultiChainTxEvent[] = []
  const unsubscribe = bulk.subscribe((e) => seen.push(e))
  unsubscribe()
  sourceA.emitBlock(
    makeBlock(100n, '0xb1', [
      { hash: '0xa1', from: '0xsender', nonce: '0x1' },
    ]),
  )
  expect(seen).toHaveLength(0)
  bulk.stop()
  multi.stop()
})

// ---------------------------------------------------------------------------
// 5. Error surfaces
// ---------------------------------------------------------------------------

test('unknown chainId throws UnknownChainIdError from every accessor', () => {
  const { multi } = makePair()
  for (const attempt of [
    () => multi.tracker(943),
    () => multi.getTxStatus(943, '0xaaa'),
    () => multi.track(943, '0xaaa'),
    () => multi.subscribe(943, '0xaaa', () => {}),
  ]) {
    expect(attempt).toThrow(UnknownChainIdError)
  }
  try {
    multi.tracker(943)
  } catch (err) {
    expect((err as UnknownChainIdError).chainId).toBe(943)
    expect((err as UnknownChainIdError).name).toBe('UnknownChainIdError')
    expect((err as Error).message).toContain('943')
    expect((err as Error).message).toContain('1, 369')
  }
  multi.stop()
})

test('coordinator onError receives chainId and composes with entry onError', () => {
  const coordinatorCalls: Array<[number, string]> = []
  const entryCalls: string[] = []
  const source = makeSource()
  const multi = createMultiChainTracker({
    chains: [
      {
        source,
        chainId: 1,
        onError: (method) => entryCalls.push(method),
      },
    ],
    onError: (chainId, method) => coordinatorCalls.push([chainId, method]),
  })
  multi.start()

  // Durable predicate subscriptions are non-durable by contract — the
  // tracker surfaces a warning through onError (spec §13.2).
  multi.trackPredicate(() => true, { durable: true })

  expect(entryCalls.length).toBeGreaterThan(0)
  expect(coordinatorCalls.length).toBeGreaterThan(0)
  expect(coordinatorCalls[0]?.[0]).toBe(1)
  multi.stop()
})

// ---------------------------------------------------------------------------
// 6. Lifecycle
// ---------------------------------------------------------------------------

test('ready() resolves once every member tracker is ready', async () => {
  const { multi } = makePair()
  await expect(multi.ready()).resolves.toBeUndefined()
  multi.stop()
})

test('stop() stops every member — subsequent blocks emit nothing', () => {
  const { multi, sourceA, sourceB } = makePair()
  const events: TxEvent[] = []
  multi.subscribe(1, '0xaaa', (e) => events.push(e), { emitInitial: false })
  multi.subscribe(369, '0xbbb', (e) => events.push(e), { emitInitial: false })
  multi.stop()

  sourceA.emitBlock(
    makeBlock(100n, '0xb1', [{ hash: '0xaaa', from: '0xs', nonce: '0x1' }]),
  )
  sourceB.emitBlock(
    makeBlock(200n, '0xb2', [{ hash: '0xbbb', from: '0xs', nonce: '0x1' }]),
  )
  expect(events.filter((e) => e.kind === 'seen-in-block')).toHaveLength(0)
})
