/**
 * The HTTP request handler — routing + the streaming scan, with every
 * dependency injected so it can be exercised without a network or a wallet.
 *
 * Routes:
 *   OPTIONS *            → 204 (CORS preflight)
 *   GET /health          → { ok, bloomsInMemory }
 *   GET /appearances     → SSE: meta → progress* → appearances* → done | error
 *   *                    → 404
 *
 * The scan is a single streaming pass: `runScan` fetches each bloom, tests
 * it, fetches only matching index chunks, and streams appearances out as
 * they're found. No load-everything-first barrier.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  isReservedAddress,
  type AppearancesResult,
  type GetAppearancesOptions,
  type Manifest,
} from '@valve-tech/unchained-reader'
import { createSse, serializeAppearances, serializeFailures } from './sse.js'
import { scopeManifest } from './scope.js'

export interface HandlerDeps {
  /** Resolve (and cache) a chain's manifest. */
  getManifest(chainKey: string): Promise<Manifest>
  /** Run the streaming appearance scan over a scoped manifest. */
  runScan(manifest: Manifest, address: string, opts: GetAppearancesOptions): Promise<AppearancesResult>
  /** Resident-bloom view — drives the `/health` count and the `warm` flag. */
  blooms: { has(cid: string): boolean; size(): number }
  /** Trailing-chunk count for a default (non-`full`) scan. */
  recentChunks: number
}

export const createRequestHandler =
  (deps: HandlerDeps) =>
  (req: IncomingMessage, res: ServerResponse): void => {
    res.setHeader('access-control-allow-origin', '*')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, bloomsInMemory: deps.blooms.size() }))
      return
    }
    if (url.pathname !== '/appearances') {
      res.writeHead(404)
      res.end('not found')
      return
    }

    const chainKey = url.searchParams.get('chain') ?? ''
    const address = url.searchParams.get('address') ?? ''
    const full = url.searchParams.get('full') === '1'
    const send = createSse(res)
    const ac = new AbortController()
    req.on('close', () => ac.abort())

    void (async (): Promise<void> => {
      try {
        if (isReservedAddress(address)) {
          send('error', {
            message: 'address ≤ 0xffff is a precompile / reserved range — not indexed by chifra',
          })
          return
        }
        const manifest = await deps.getManifest(chainKey)
        if (ac.signal.aborted) return

        const scoped = scopeManifest(manifest, { full, recentChunks: deps.recentChunks })
        send('meta', {
          chunks: scoped.chunks.length,
          first: scoped.chunks[0]?.range.first.toString() ?? '0',
          last: scoped.chunks[scoped.chunks.length - 1]?.range.last.toString() ?? '0',
          warm: scoped.chunks.every((c) => deps.blooms.has(c.bloomHash)),
        })

        const result = await deps.runScan(scoped, address, {
          signal: ac.signal,
          onProgress: (p) => send('progress', p),
          onAppearances: (found) => send('appearances', serializeAppearances(found)),
        })
        if (ac.signal.aborted) return
        send('done', { total: result.appearances.length, failures: serializeFailures(result.failures) })
      } catch (err) {
        if (!ac.signal.aborted) send('error', { message: err instanceof Error ? err.message : String(err) })
      } finally {
        res.end()
      }
    })()
  }
