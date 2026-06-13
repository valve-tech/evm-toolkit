/**
 * One self-contained query "load". Runs (and streams) ONCE on mount, owns
 * all of its own state, and renders as a collapsible card. The App keeps a
 * list of these — newest first — so every search becomes its own history
 * row that keeps its results while later searches run alongside it.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Appearance, Progress } from '@valve-tech/unchained-reader'

import { BACKEND_URL, CHIFRA_URL, DEFAULT_RECENT_CHUNKS, type ChainConfig } from '../config'
import { queryHistory, type QueryFailure, type StreamQuery } from '../lib/history'
import { queryViaBackend } from '../lib/backend'
import { queryViaChifra } from '../lib/chifra'
import { hydrate, RpcRateLimitError, type TxRow } from '../lib/rpc'
import { rpcGate } from '../lib/rpc-gate'
import { shortAddr, shortHash, formatBytes } from '../lib/format'
import { ResultsTable } from './ResultsTable'

export interface LoadParams {
  id: number
  chain: ChainConfig
  address: string
  fullHistory: boolean
}

type Phase = 'scanning' | 'done' | 'error'

const keyParts = (k: string): [bigint, bigint] => {
  const [b, t] = k.split(':')
  return [BigInt(b), BigInt(t)]
}
const cmpKey = (a: string, b: string): number => {
  const [ab, at] = keyParts(a)
  const [bb, bt] = keyParts(b)
  if (ab !== bb) return ab < bb ? -1 : 1
  if (at !== bt) return at < bt ? -1 : 1
  return 0
}

// Workers per card; the GLOBAL rpcGate (shared across all cards) paces the
// actual request rate and applies 429 backpressure, so this is just how many
// hydrations a card will have in flight waiting at the gate.
const HYDRATE_CONCURRENCY = 4
const HYDRATE_RETRIES = 5

const emptyProgress: Progress = {
  chunksTotal: 0,
  bloomsFetched: 0,
  hits: 0,
  chunksFetched: 0,
  appearancesFound: 0,
  bytesFetched: 0,
}

// Source priority: chifra daemon (fastest, direct /list) → in-memory bloom
// backend → trustless browser scan.
type Source = 'chifra' | 'backend' | 'direct'
const SOURCE: Source = CHIFRA_URL ? 'chifra' : BACKEND_URL ? 'backend' : 'direct'
const querySource: StreamQuery =
  SOURCE === 'chifra' ? queryViaChifra : SOURCE === 'backend' ? queryViaBackend : queryHistory

const key = (b: bigint, t: bigint): string => `${b}:${t}`

export const LoadCard = ({ params, onRemove }: { params: LoadParams; onRemove: () => void }) => {
  const { chain, address, fullHistory } = params
  const [collapsed, setCollapsed] = useState(false)
  const [phase, setPhase] = useState<Phase>('scanning')
  const [progress, setProgress] = useState<Progress>(emptyProgress)
  const [rows, setRows] = useState<Map<string, TxRow | 'pending' | 'error'>>(new Map())
  const [order, setOrder] = useState<string[]>([])
  const [failures, setFailures] = useState<QueryFailure[]>([])
  const [error, setError] = useState<string | null>(null)
  const [scanned, setScanned] = useState<{ first: bigint; last: bigint; chunks: number } | null>(
    null,
  )
  const [loadStatus, setLoadStatus] = useState<{ done: number; total: number } | null>(null)
  // Direct mode resolves the manifest with one client-side eth_call; chifra
  // and backend do their resolution server-side. Hydration adds one per tx.
  const [rpcCalls, setRpcCalls] = useState(SOURCE === 'direct' ? 1 : 0)
  // Bytes THIS browser pulled beyond the scan: SSE stream (backend mode) +
  // tx hydration responses (both modes).
  const [clientExtra, setClientExtra] = useState(0)
  // Total appearances found. `order` only holds the ones in flight / done —
  // the rest wait in the queue rather than painting a wall of pending rows.
  const [found, setFound] = useState(0)

  // Run the query exactly once, on mount. Abort on unmount.
  useEffect(() => {
    const ac = new AbortController()
    const queue: Appearance[] = []
    const seen = new Set<string>()
    let scanDone = false

    const worker = async (): Promise<void> => {
      for (;;) {
        if (ac.signal.aborted) return
        const app = queue.shift()
        if (app === undefined) {
          if (scanDone) return
          await new Promise((r) => setTimeout(r, 40))
          continue
        }
        const k = key(app.blockNumber, app.transactionIndex)
        // Claim → render the row in flight. Only ~HYDRATE_CONCURRENCY are
        // ever pending at once; the rest stay queued, not on screen.
        setOrder((prev) => (prev.includes(k) ? prev : [...prev, k].sort(cmpKey)))
        setRows((prev) => new Map(prev).set(k, 'pending'))
        let settled = false
        for (let attempt = 0; attempt < HYDRATE_RETRIES && !settled; attempt += 1) {
          await rpcGate.acquire(ac.signal) // global pacing + 429 backpressure
          if (ac.signal.aborted) return
          setRpcCalls((c) => c + 1)
          try {
            const { row, bytes } = await hydrate(chain.rpcUrl, app)
            rpcGate.reward()
            setClientExtra((c) => c + bytes)
            setRows((prev) => new Map(prev).set(k, row))
            settled = true
          } catch (err) {
            if (err instanceof RpcRateLimitError) {
              rpcGate.throttle(err.retryAfterMs) // slow everyone, then retry this tx
              continue
            }
            setRows((prev) => new Map(prev).set(k, 'error'))
            settled = true
          }
        }
        if (!settled) setRows((prev) => new Map(prev).set(k, 'error')) // gave up after retries
      }
    }
    const workers = Array.from({ length: HYDRATE_CONCURRENCY }, worker)

    const onAppearances = (incoming: Appearance[]): void => {
      let fresh = 0
      for (const a of incoming) {
        const k = key(a.blockNumber, a.transactionIndex)
        if (seen.has(k)) continue
        seen.add(k)
        queue.push(a)
        fresh += 1
      }
      // Count them now; a row is only rendered once a worker starts it.
      if (fresh > 0) setFound((n) => n + fresh)
    }

    const go = async (): Promise<void> => {
      try {
        const outcome = await querySource(
          chain,
          address,
          { fullHistory },
          {
            onProgress: (p) => setProgress(p),
            onAppearances,
            onStatus: (s) => setLoadStatus({ done: s.loadingDone, total: s.loadingTotal }),
            onWire: (b) => setClientExtra((c) => c + b),
          },
          ac.signal,
        )
        if (ac.signal.aborted) return
        setLoadStatus(null)
        setFailures(outcome.failures)
        if (outcome.scanned) setScanned(outcome.scanned)
      } catch (err) {
        scanDone = true
        if (ac.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
        setPhase('error')
        return
      }
      scanDone = true
      await Promise.all(workers)
      if (!ac.signal.aborted) setPhase('done')
    }
    void go()

    return () => ac.abort()
    // params are fixed for this card instance — intentionally run once.
  }, [])

  const pct = useMemo(() => {
    if (progress.chunksTotal === 0) return 0
    return Math.round((progress.bloomsFetched / progress.chunksTotal) * 100)
  }, [progress])
  const hydratedCount = useMemo(
    () => [...rows.values()].filter((r) => typeof r === 'object').length,
    [rows],
  )
  // What THIS browser actually pulled vs (backend mode) the server-side scan.
  // Direct mode: the browser does the scan, so its wire = scan + hydration.
  const clientWire = clientExtra + (SOURCE === 'direct' ? progress.bytesFetched : 0)
  const serverScan = SOURCE === 'backend' ? progress.bytesFetched : 0

  const statusLabel =
    phase === 'error'
      ? 'error'
      : phase === 'done'
        ? 'done'
        : SOURCE === 'chifra'
          ? 'querying'
          : loadStatus
            ? 'loading blooms'
            : 'scanning'

  const phaseNote =
    phase === 'done'
      ? SOURCE === 'chifra'
        ? `Done — ${found.toLocaleString()} appearance${found === 1 ? '' : 's'} via chifra daemon.`
        : `Done — scanned ${progress.bloomsFetched.toLocaleString()} blooms, parsed ${progress.chunksFetched.toLocaleString()} chunks.`
      : SOURCE === 'chifra'
        ? found > 0
          ? `chifra returned ${found.toLocaleString()} · hydrating ${hydratedCount.toLocaleString()}/${found.toLocaleString()}…`
          : 'Querying chifra daemon…'
        : loadStatus
          ? `Loading blooms into memory — ${loadStatus.done.toLocaleString()}/${loadStatus.total.toLocaleString()} (first query for this chain)…`
          : `Streaming — ${progress.bloomsFetched.toLocaleString()}/${progress.chunksTotal.toLocaleString()} blooms scanned · ${progress.appearancesFound.toLocaleString()} appearance${progress.appearancesFound === 1 ? '' : 's'} so far…`

  return (
    <section className={`load-card${phase === 'error' ? ' is-error' : ''}`}>
      <div className="load-head">
        <button
          type="button"
          className="load-head-main"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span className="chevron" aria-hidden="true">{collapsed ? '›' : '⌄'}</span>
          <img
            className="chain-ico"
            src={`https://gib.show/image/eip155-${chain.chainId}`}
            alt=""
            width={16}
            height={16}
          />
          <span className="load-addr">{shortAddr(address)}</span>
          <span className={`load-status load-status-${phase}`}>{statusLabel}</span>
          <span className="load-count">
            {found.toLocaleString()} txn{found === 1 ? '' : 's'}
          </span>
        </button>
        <button type="button" className="load-close" aria-label="Remove" onClick={onRemove}>
          ✕
        </button>
      </div>

      {!collapsed && (
        <div className="load-body">
          {(phase === 'scanning' || phase === 'done') && (
            <section className="progress">
              {SOURCE !== 'chifra' && (progress.chunksTotal > 0 || loadStatus !== null) && (
                <div className="progress-bar-track">
                  <div
                    className={`progress-bar-fill${phase === 'scanning' && pct === 0 ? ' indeterminate' : ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              {SOURCE !== 'chifra' && (progress.chunksTotal > 0 || loadStatus !== null) && (
                <div className="stat-grid">
                  <Stat n={progress.chunksTotal} k="chunks in scope" tip="Index chunks inside the searched range — the address can only appear within these. Each chunk is one small bloom filter + one larger index file on IPFS." />
                  <Stat n={progress.bloomsFetched} k="blooms read" tip="Bloom filters downloaded — one per chunk in scope. Every bloom must be fetched to test it, so this rises to equal the chunks in scope." />
                  <Stat n={progress.hits} k="bloom hits" accent tip="Chunks whose bloom says the address MIGHT be inside. Only these get a full (larger) index download. Blooms can false-positive, so a hit is a maybe." />
                  <Stat n={progress.chunksFetched} k="chunks parsed" tip="Index files actually downloaded and parsed — one per bloom hit. These hold the authoritative list of the address's appearances." />
                  <Stat n={progress.appearancesFound} k="appearances" accent tip="Confirmed (block, transaction-index) appearances found in the parsed indexes. Each becomes a row in the table below." />
                </div>
              )}
              <div className="metrics">
                  <span
                    className="metric"
                    title={
                      SOURCE === 'backend'
                        ? 'Left: bytes your browser pulled (SSE stream + tx hydration). Right: bytes the server scanned from IPFS (blooms + index chunks) — NOT transferred to you.'
                        : SOURCE === 'chifra'
                          ? 'Bytes your browser pulled from the chifra daemon: the appearance list + tx hydration.'
                          : 'Bytes your browser pulled: blooms + index chunks + tx hydration.'
                    }
                  >
                    <b>{formatBytes(clientWire)}</b>
                    {SOURCE === 'backend' ? (
                      <>
                        {' / '}
                        <b>{formatBytes(serverScan)}</b>
                      </>
                    ) : null}{' '}
                    over the wire{' '}
                    <em>{SOURCE === 'backend' ? '(you / server scan)' : '(this browser)'}</em>
                  </span>
                  <span className="metric">
                    <b>{hydratedCount.toLocaleString()}</b> of {found.toLocaleString()} txns
                    hydrated
                  </span>
                  <span className="metric">
                    <b>{rpcCalls.toLocaleString()}</b> private RPC call{rpcCalls === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="phase-note">{phaseNote}</p>
              </section>
            )}

          {error && (
            <div className="panel error">
              <h3>Couldn’t complete the trace</h3>
              {error}
            </div>
          )}

          {order.length > 0 && (
            <ResultsTable
              chain={chain}
              self={address.toLowerCase()}
              order={order}
              rows={rows}
              total={found}
            />
          )}

          {phase === 'done' && found === 0 && !error && (
            <div className="panel empty">
              <strong>No appearances for {shortAddr(address)}</strong> on {chain.label}.
              {scanned && (
                <div className="empty-scope">
                  Searched {fullHistory ? 'the full index' : `the last ${scanned.chunks} chunks`} —
                  blocks {scanned.first.toLocaleString()}–{scanned.last.toLocaleString()}.
                </div>
              )}
              {!fullHistory && (
                <div className="empty-hint">
                  The address may be active <em>outside this window</em>. Tick{' '}
                  <strong>“search all history”</strong> ({DEFAULT_RECENT_CHUNKS}+ chunks) and re-run.
                </div>
              )}
            </div>
          )}

          {failures.length > 0 && (
            <div className="panel warn">
              <h3>⚠ {failures.length} chunk{failures.length > 1 ? 's' : ''} could not be read</h3>
              Results above are therefore <strong>partial</strong> — these ranges were skipped, not
              empty.
              <ul>
                {failures.slice(0, 6).map((f, i) => (
                  <li key={i}>
                    blocks {f.first.toString()}–{f.last.toString()} · {f.reason} ·{' '}
                    {shortHash(f.cid, 8, 6)}
                  </li>
                ))}
                {failures.length > 6 && <li>…and {failures.length - 6} more</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

const Stat = ({ n, k, tip, accent }: { n: number; k: string; tip: string; accent?: boolean }) => (
  <div className="stat" tabIndex={0} data-tip={tip} aria-label={`${k}: ${tip}`}>
    <div className={`n${accent ? ' accent' : ''}`}>{n.toLocaleString()}</div>
    <div className="k">
      {k}
      <span className="info" aria-hidden="true">
        ?
      </span>
    </div>
  </div>
)
