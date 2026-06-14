import { describe, it, expect } from 'vitest'
import type { Appearance } from '@valve-tech/unchained-reader'

import { foldBatchTxResponse, type BatchResponseItem } from './rpc'

const app = (b: bigint, t: bigint): Appearance => ({ blockNumber: b, transactionIndex: t })

describe('foldBatchTxResponse', () => {
  it('maps each appearance to a row using the app block/idx and the raw tx fields', () => {
    const apps = [app(369n, 4n), app(370n, 0n)]
    const items: BatchResponseItem[] = [
      { id: 0, result: { hash: '0xaaa', from: '0xfrom0', to: '0xto0', value: '0xde0b6b3a7640000' } },
      { id: 1, result: { hash: '0xbbb', from: '0xfrom1', to: '0xto1', value: '0x0' } },
    ]
    const { rows, failed } = foldBatchTxResponse(apps, items)
    expect(failed).toEqual([])
    expect(rows).toEqual([
      { blockNumber: 369n, transactionIndex: 4n, hash: '0xaaa', from: '0xfrom0', to: '0xto0', value: 10n ** 18n },
      { blockNumber: 370n, transactionIndex: 0n, hash: '0xbbb', from: '0xfrom1', to: '0xto1', value: 0n },
    ])
  })

  it('matches results to appearances by id, not array position', () => {
    const apps = [app(100n, 1n), app(200n, 2n)]
    const items: BatchResponseItem[] = [
      { id: 1, result: { hash: '0xb', from: '0xf', to: '0xt', value: '0x1' } },
      { id: 0, result: { hash: '0xa', from: '0xf', to: '0xt', value: '0x2' } },
    ]
    const { rows } = foldBatchTxResponse(apps, items)
    expect(rows.map((r) => [r.blockNumber, r.hash])).toEqual([
      [100n, '0xa'],
      [200n, '0xb'],
    ])
  })

  it('routes null results, per-item errors, and missing ids to failed (not rows)', () => {
    const apps = [app(1n, 0n), app(2n, 0n), app(3n, 0n)]
    const items: BatchResponseItem[] = [
      { id: 0, result: null }, // tx not found at that index
      { id: 1, error: { message: 'boom' } }, // node error for this sub-request
      // id 2 absent entirely
    ]
    const { rows, failed } = foldBatchTxResponse(apps, items)
    expect(rows).toEqual([])
    expect(failed).toEqual([app(1n, 0n), app(2n, 0n), app(3n, 0n)])
  })

  it('keeps a contract-creation to (null) as null', () => {
    const apps = [app(5n, 9n)]
    const items: BatchResponseItem[] = [
      { id: 0, result: { hash: '0xc', from: '0xf', to: null, value: '0x0' } },
    ]
    expect(foldBatchTxResponse(apps, items).rows[0].to).toBeNull()
  })
})
