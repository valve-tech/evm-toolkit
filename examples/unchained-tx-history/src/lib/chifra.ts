/**
 * chifra-daemon source as a pull-based {@link AppearanceCursor}.
 *
 * Asks the TrueBlocks daemon's `/list` endpoint (via `@valve-tech/trueblocks-sdk`)
 * for an address's appearances. The daemon already has the index parsed on disk,
 * so there is NO bloom or chunk download — the browser pulls only appearance
 * coordinates (then hydrates tx detail over RPC).
 *
 * Crucially it is LAZY: one cheap `count` call gives the exact total, then we
 * page (`firstRecord`/`maxRecords`, `reversed` for newest-first) only as the UI
 * asks for more. A whale with thousands of appearances therefore costs one
 * count + the pages actually shown, not its entire coordinate list up front.
 *
 * (We deliberately do NOT use `chifra transactions` to hydrate server-side:
 * that endpoint drags a full receipt per tx and is pathologically slow for an
 * address's history. Lean per-tx RPC hydration, batched, is far faster.)
 */
import { createTrueblocksClient, type FetchFn } from '@valve-tech/trueblocks-sdk'
import type { Appearance } from '@valve-tech/unchained-reader'

import type { ChainConfig } from '../config'
import type { AppearanceCursor, AppearancePage, SortOrder } from './cursor'

export const createChifraCursor = (
  chifraUrl: string,
  chain: ChainConfig,
  address: string,
  order: SortOrder,
  signal: AbortSignal,
  onWire?: (bytes: number) => void,
): AppearanceCursor => {
  // Thread the abort signal through the sdk's single-arg fetch, and account for
  // the bytes this browser pulls. Read the byte count off a CLONE and hand the
  // sdk the untouched original response — rebuilding it from decompressed text
  // corrupts the sdk's `.json()` on large gzipped payloads.
  const trackedFetch: FetchFn = async (input, init) => {
    const res = await fetch(input, { ...init, signal })
    if (res.ok && onWire) {
      res
        .clone()
        .arrayBuffer()
        .then((buf) => onWire(buf.byteLength))
        .catch(() => {})
    }
    return res
  }
  const client = createTrueblocksClient({ baseUrl: chifraUrl, fetch: trackedFetch })

  let total: number | null = null
  let counted = false
  let firstRecord = 0
  let done = false
  const reversed = order === 'newest' // chifra `reversed` === reverse-chronological

  const ensureCount = async (): Promise<void> => {
    if (counted) return
    counted = true
    try {
      const res = await client.list({ addrs: [address], chain: chain.chifraChain, count: true })
      const n = (res.data?.[0] as { nRecords?: number } | undefined)?.nRecords
      if (typeof n === 'number') total = n
    } catch {
      /* count is best-effort — we still detect the end via a short page */
    }
  }

  const next = async (pageSize: number): Promise<AppearancePage> => {
    await ensureCount()
    if (done || signal.aborted) return { appearances: [], done: true }
    const res = await client.list({
      addrs: [address],
      chain: chain.chifraChain,
      fmt: 'json',
      reversed,
      firstRecord,
      maxRecords: pageSize,
    })
    const records = res.data ?? []
    firstRecord += records.length
    if (records.length < pageSize) done = true
    if (total !== null && firstRecord >= total) done = true
    const appearances: Appearance[] = []
    for (const record of records) {
      const blockNumber = (record as { blockNumber?: number }).blockNumber
      const transactionIndex = (record as { transactionIndex?: number }).transactionIndex
      if (typeof blockNumber === 'number' && typeof transactionIndex === 'number') {
        appearances.push({
          blockNumber: BigInt(blockNumber),
          transactionIndex: BigInt(transactionIndex),
        })
      }
    }
    return { appearances, done }
  }

  return {
    get total() {
      return total
    },
    next,
    outcome: () => ({ scanned: null, failures: [] }),
  }
}
