/**
 * chifra-daemon query path. Asks the TrueBlocks daemon's `/list` endpoint
 * (via `@valve-tech/trueblocks-sdk`) for an address's appearances directly —
 * the daemon already has the index parsed on disk, so there is NO bloom or
 * chunk download. Fastest source; the browser pulls only the appearance list
 * (then hydrates tx detail over RPC like the other paths).
 *
 * Implements the same {@link StreamQuery} contract as the direct + backend
 * paths, so the App renders identically.
 */
import { createTrueblocksClient, type FetchFn } from '@valve-tech/trueblocks-sdk'
import type { Appearance } from '@valve-tech/unchained-reader'

import { CHIFRA_URL } from '../config'
import type { QueryOutcome, StreamQuery } from './history'

export const queryViaChifra: StreamQuery = async (chain, address, _scope, handlers, signal) => {
  // Thread the abort signal through the sdk's single-arg fetch, and account
  // for the bytes this browser pulls from the daemon (rebuild the Response so
  // the sdk can still parse it).
  const trackedFetch: FetchFn = async (input, init) => {
    const res = await fetch(input, { ...init, signal })
    if (!res.ok) return res
    const text = await res.text()
    handlers.onWire?.(new TextEncoder().encode(text).length)
    return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers })
  }

  const client = createTrueblocksClient({ baseUrl: CHIFRA_URL, fetch: trackedFetch })

  // The daemon caps /list at ~250 records per call (its default max_records),
  // so page through with firstRecord/maxRecords until a short page. Each page
  // is streamed to onAppearances as it arrives, so hydration of page N starts
  // while page N+1 is still being fetched — no waiting for the whole list.
  // (chifra searches its full local index; recent-vs-full scope doesn't apply.)
  const PAGE = 250
  for (let firstRecord = 0; ; firstRecord += PAGE) {
    if (signal.aborted) break
    const res = await client.list({
      addrs: [address],
      chain: chain.chifraChain,
      fmt: 'json',
      firstRecord,
      maxRecords: PAGE,
    })
    const records = res.data ?? []
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
    if (appearances.length > 0) handlers.onAppearances(appearances)
    if (records.length < PAGE) break // last (short) page
  }

  return { scanned: null, failures: [] } satisfies QueryOutcome
}
