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

  // chifra searches its full local index; recent-vs-full scope doesn't apply.
  const res = await client.list({ addrs: [address], chain: chain.chifraChain, fmt: 'json' })
  if (signal.aborted) return { scanned: null, failures: [] }

  const appearances: Appearance[] = []
  for (const record of res.data ?? []) {
    const blockNumber = (record as { blockNumber?: number }).blockNumber
    const transactionIndex = (record as { transactionIndex?: number }).transactionIndex
    if (typeof blockNumber === 'number' && typeof transactionIndex === 'number') {
      appearances.push({
        blockNumber: BigInt(blockNumber),
        transactionIndex: BigInt(transactionIndex),
      })
    }
  }
  handlers.onAppearances(appearances)

  return { scanned: null, failures: [] } satisfies QueryOutcome
}
