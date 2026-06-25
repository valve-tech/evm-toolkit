/**
 * Server-Sent Events framing + the wire serializers for this server.
 *
 * SSE is the wire boundary, so bigints (block numbers, transaction
 * indices) are encoded as decimal strings here — never sent raw, since
 * `JSON.stringify` throws on a bigint. The browser client parses them
 * back. (Decimal, not hex: this example's own wire contract.)
 */
import type { ServerResponse } from 'node:http'
import type { Appearance, ChunkFailure } from '@valve-tech/unchained-reader'

/** Emit one named SSE event with a JSON payload. */
export type SseSend = (event: string, data: unknown) => void

/** Write SSE headers and return a sender bound to the response. */
export const createSse = (res: ServerResponse): SseSend => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
  })
  return (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
}

/** Wire form of a batch of appearances — bigints as decimal strings. */
export const serializeAppearances = (
  found: readonly Appearance[],
): { blockNumber: string; transactionIndex: string }[] =>
  found.map((a) => ({
    blockNumber: a.blockNumber.toString(),
    transactionIndex: a.transactionIndex.toString(),
  }))

/** Wire form of chunk failures — block range as decimal strings. */
export const serializeFailures = (
  failures: readonly ChunkFailure[],
): { first: string; last: string; cid: string; reason: string }[] =>
  failures.map((f) => ({
    first: f.range.first.toString(),
    last: f.range.last.toString(),
    cid: f.cid,
    reason: f.reason,
  }))
