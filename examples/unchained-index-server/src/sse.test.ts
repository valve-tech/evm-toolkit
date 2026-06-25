import { describe, it, expect } from 'vitest'
import type { ServerResponse } from 'node:http'
import type { Appearance, ChunkFailure } from '@valve-tech/unchained-reader'
import { FailureReason } from '@valve-tech/unchained-reader'
import { createSse, serializeAppearances, serializeFailures } from './sse'

/** Minimal ServerResponse stand-in that records the head and the writes. */
const fakeRes = () => {
  const writes: string[] = []
  let head: { status: number; headers: Record<string, string> } | undefined
  const res = {
    writeHead: (status: number, headers: Record<string, string>) => {
      head = { status, headers }
      return res
    },
    write: (chunk: string) => {
      writes.push(chunk)
      return true
    },
  }
  return { res: res as unknown as ServerResponse, writes, head: () => head }
}

describe('createSse', () => {
  it('writes text/event-stream headers with CORS open', () => {
    const f = fakeRes()
    createSse(f.res)
    expect(f.head()?.status).toBe(200)
    expect(f.head()?.headers['content-type']).toBe('text/event-stream')
    expect(f.head()?.headers['cache-control']).toBe('no-cache')
    expect(f.head()?.headers['access-control-allow-origin']).toBe('*')
  })

  it('frames each event as `event: <name>\\ndata: <json>\\n\\n`', () => {
    const f = fakeRes()
    const send = createSse(f.res)
    send('meta', { chunks: 6, warm: true })
    send('done', { total: 2 })
    expect(f.writes).toEqual([
      'event: meta\ndata: {"chunks":6,"warm":true}\n\n',
      'event: done\ndata: {"total":2}\n\n',
    ])
  })
})

describe('serializeAppearances', () => {
  it('encodes bigint block number + tx index as decimal strings', () => {
    const found: Appearance[] = [
      { blockNumber: 18_000_000n, transactionIndex: 42n },
      { blockNumber: 0n, transactionIndex: 0n },
    ]
    expect(serializeAppearances(found)).toEqual([
      { blockNumber: '18000000', transactionIndex: '42' },
      { blockNumber: '0', transactionIndex: '0' },
    ])
  })

  it('is JSON-safe (raw bigints would throw)', () => {
    expect(() => JSON.stringify(serializeAppearances([{ blockNumber: 1n, transactionIndex: 2n }]))).not.toThrow()
  })
})

describe('serializeFailures', () => {
  it('encodes the failed range as decimal strings and carries cid + reason', () => {
    const failures: ChunkFailure[] = [
      { range: { first: 100n, last: 199n }, cid: 'QmBad', reason: FailureReason.fetch, detail: 'HTTP 504' },
    ]
    expect(serializeFailures(failures)).toEqual([
      { first: '100', last: '199', cid: 'QmBad', reason: 'fetch' },
    ])
  })
})
