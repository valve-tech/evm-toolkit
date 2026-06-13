/**
 * Backend-accelerated query path. Points at the
 * `@valve-tech/example-unchained-index-server` SSE endpoint, which holds the
 * chain's bloom filters in memory and streams appearances back as it finds
 * them — turning a multi-GB client-side bloom scan into one small request.
 *
 * Implements the same {@link StreamQuery} contract as the direct path, so
 * the App renders/hydrates identically regardless of source. (Hydration of
 * tx details still happens client-side over the user's RPC.)
 */
import { BACKEND_URL } from '../config'
import type { QueryFailure, QueryOutcome, Scanned, StreamQuery } from './history'

interface SseEvent {
  event: string
  data: unknown
}

/** Parse one raw SSE block ("event: x\ndata: y") into {event, data}. */
const parseSseBlock = (raw: string): SseEvent | null => {
  let event = 'message'
  let data = ''
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  if (!data) return null
  try {
    return { event, data: JSON.parse(data) }
  } catch {
    return null
  }
}

export const queryViaBackend: StreamQuery = async (chain, address, scope, handlers, signal) => {
  const url =
    `${BACKEND_URL}/appearances` +
    `?chain=${encodeURIComponent(chain.chainKey)}` +
    `&address=${encodeURIComponent(address)}` +
    `&full=${scope.fullHistory ? '1' : '0'}`

  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`backend: HTTP ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let scanned: Scanned | null = null
  let failures: QueryFailure[] = []
  let errorMessage: string | null = null

  const handle = (ev: SseEvent): void => {
    switch (ev.event) {
      case 'loading': {
        const d = ev.data as { done: number; total: number }
        handlers.onStatus?.({ loadingDone: d.done, loadingTotal: d.total })
        break
      }
      case 'progress':
        handlers.onProgress(ev.data as Parameters<typeof handlers.onProgress>[0])
        break
      case 'appearances': {
        const arr = ev.data as { blockNumber: string; transactionIndex: string }[]
        handlers.onAppearances(
          arr.map((a) => ({
            blockNumber: BigInt(a.blockNumber),
            transactionIndex: BigInt(a.transactionIndex),
          })),
        )
        break
      }
      case 'meta': {
        const m = ev.data as { chunks: number; first: string; last: string }
        scanned = { first: BigInt(m.first), last: BigInt(m.last), chunks: m.chunks }
        break
      }
      case 'done': {
        const d = ev.data as {
          failures: { first: string; last: string; cid: string; reason: string }[]
        }
        failures = d.failures.map((f) => ({
          first: BigInt(f.first),
          last: BigInt(f.last),
          cid: f.cid,
          reason: f.reason,
        }))
        break
      }
      case 'error':
        errorMessage = (ev.data as { message: string }).message
        break
      default:
        break
    }
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const ev = parseSseBlock(block)
      if (ev) handle(ev)
    }
  }

  if (errorMessage) throw new Error(errorMessage)
  return { scanned, failures } satisfies QueryOutcome
}
