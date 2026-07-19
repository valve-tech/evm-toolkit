import { describe, it, expect } from 'vitest'

import { parseSseBlock } from './backend'

describe('parseSseBlock', () => {
  it('parses a single-line event + data', () => {
    expect(parseSseBlock('event: progress\ndata: {"chunksFetched":3}')).toEqual({
      event: 'progress',
      data: { chunksFetched: 3 },
    })
  })

  it('defaults the event name to "message" when absent', () => {
    expect(parseSseBlock('data: {"ok":true}')).toEqual({ event: 'message', data: { ok: true } })
  })

  it('joins multiple data: lines with a newline so a split JSON payload round-trips', () => {
    // The regression: a large appearances array split across frames. Bare
    // concatenation would fuse `...123}]` + `[{"blockNumber...` into malformed
    // JSON and drop the whole event. Newline-join keeps it valid.
    const block = 'event: appearances\ndata: [{"blockNumber":"1","transactionIndex":"0"},\ndata: {"blockNumber":"2","transactionIndex":"5"}]'
    expect(parseSseBlock(block)).toEqual({
      event: 'appearances',
      data: [
        { blockNumber: '1', transactionIndex: '0' },
        { blockNumber: '2', transactionIndex: '5' },
      ],
    })
  })

  it('tolerates the optional single leading space after "data:" (spec form)', () => {
    // Servers may or may not put a space after the colon; both must parse the
    // same. (For JSON payloads JSON.parse also ignores the space, but the strip
    // keeps us spec-correct for any non-JSON consumer.)
    expect(parseSseBlock('data: {"a":1}')).toEqual(parseSseBlock('data:{"a":1}'))
  })

  it('returns null for a block with no data: line', () => {
    expect(parseSseBlock('event: ping')).toBeNull()
  })

  it('returns null when the reassembled data is not valid JSON', () => {
    expect(parseSseBlock('data: not-json')).toBeNull()
  })
})
