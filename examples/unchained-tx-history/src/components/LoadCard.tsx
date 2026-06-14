/**
 * One self-contained query "load". Runs (and streams) ONCE on mount, owns
 * all of its own state, and renders as a collapsible card. The App keeps a
 * list of these — newest first — so every search becomes its own history
 * row that keeps its results while later searches run alongside it.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Appearance, Progress } from '@valve-tech/unchained-reader'

import { BACKEND_URL, DEFAULT_RECENT_CHUNKS, type ChainConfig } from '../config'
import { queryHistory, type QueryFailure, type StreamQuery } from '../lib/history'
import { queryViaBackend } from '../lib/backend'
import { createChifraCursor } from '../lib/chifra'
import type { SortOrder } from '../lib/cursor'
import { hydrateBatch, RpcRateLimitError, type TxRow } from '../lib/rpc'
import { rpcGate } from '../lib/rpc-gate'
import { shortAddr, shortHash, formatBytes } from '../lib/format'
import { ResultsTable } from './ResultsTable'

export interface LoadParams {
  id: number
  chain: ChainConfig
  address: string
  fullHistory: boolean
  /** chifra daemon base URL for this search; '' means use the trustless path. */
  chifraUrl: string
  /** Load newest- or oldest-first. */
  order: SortOrder
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
// batches a card will have in flight waiting at the gate.
const HYDRATE_CONCURRENCY = 4
const HYDRATE_RETRIES = 5
// Appearances hydrated per JSON-RPC batch request. One `rpcGate.acquire()` and
// one HTTP round trip cover the whole batch, so the gate's per-second pace now
// buys BATCH_SIZE× the transactions — the throttling lever the public nodes
// (rpc.pulsechain.com, g4mm4) tolerate far better than a request-per-tx flood.
const BATCH_SIZE = 16
// Hydration is bounded to this many of the newest appearances per "page";
// "Load more" raises the budget by another page. Finding appearances stays
// cheap and exhaustive — only the expensive RPC hydration paginates.
const PAGE_SIZE = 50

const emptyProgress: Progress = {
  chunksTotal: 0,
  bloomsFetched: 0,
  hits: 0,
  chunksFetched: 0,
  appearancesFound: 0,
  bytesFetched: 0,
}

// Source priority for THIS search: a chifra daemon (fastest, direct /list) when
// one is selected → in-memory bloom backend → trustless browser scan.
type Source = 'chifra' | 'backend' | 'direct'

const key = (b: bigint, t: bigint): string => `${b}:${t}`

/** Compact duration: "340 ms" under a second, "1.2 s" / "12 s" above. */
const formatMs = (ms: number): string =>
  ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 9500 ? 1 : 0)} s`

export const LoadCard = ({ params, onRemove }: { params: LoadParams; onRemove: () => void }) => {
  const { chain, address, fullHistory, chifraUrl, order: loadOrder } = params
  // Source is per-search now (the chifra instance can be swapped at runtime).
  // chifra uses the lazy cursor below; backend/direct stream via `querySource`.
  const source: Source = chifraUrl ? 'chifra' : BACKEND_URL ? 'backend' : 'direct'
  const querySource: StreamQuery = source === 'backend' ? queryViaBackend : queryHistory
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
  const [rpcCalls, setRpcCalls] = useState(source === 'direct' ? 1 : 0)
  // Bytes THIS browser pulled beyond the scan: SSE stream (backend mode) +
  // tx hydration responses (both modes).
  const [clientExtra, setClientExtra] = useState(0)
  // Total appearances found. `order` only holds the ones in flight / done —
  // the rest wait in the queue rather than painting a wall of pending rows.
  const [found, setFound] = useState(0)
  // Phase ① (finding appearances) is complete once the query source has
  // emitted everything; phase ② (hydration) keeps running until the workers
  // drain. Tracked so the UI can show the two steps independently.
  const [appearancesDone, setAppearancesDone] = useState(false)
  // Grand total of appearances (chifra: from the cheap `count`; backend/direct:
  // null until the scan finishes, then = found). `feedExhausted` = every
  // appearance has been FETCHED (vs `appearancesDone` = the total is known).
  const [total, setTotal] = useState<number | null>(null)
  const [feedExhausted, setFeedExhausted] = useState(false)
  // Pagination: `budget` is how many appearances we'll hydrate; `started` is how
  // many have begun hydrating. Workers pause once `started` reaches `budget`
  // and resume when "Load more" raises it. Refs mirror them for the worker
  // closures (which are created once, on mount).
  const [budget, setBudget] = useState(PAGE_SIZE)
  const [started, setStarted] = useState(0)
  const budgetRef = useRef(PAGE_SIZE)
  const startedRef = useRef(0)
  // Cost timing (refs, read at render — which re-runs as rows settle): mount,
  // first-appearance, and last-activity marks. finding = mount→first; the rest
  // is hydration.
  const tStartRef = useRef(0)
  const tFirstRef = useRef(0)
  const tLastRef = useRef(0)
  useEffect(() => {
    budgetRef.current = budget
  }, [budget])

  // Run the query exactly once, on mount. Abort on unmount.
  useEffect(() => {
    tStartRef.current = performance.now()
    const ac = new AbortController()
    const queue: Appearance[] = []
    const seen = new Set<string>()
    let scanDone = false

    // Surface a batch's SETTLED results into the table. Only settled rows
    // (hydrated, or terminally failed) ever enter `order` — pending rows are
    // never rendered, since with batching there'd be up to
    // HYDRATE_CONCURRENCY × BATCH_SIZE in flight at once (a wall of "fetching…"
    // eating vertical space). The in-flight count shows only in the summary.
    const showSettled = (entries: Array<[string, TxRow | 'error']>): void => {
      if (entries.length === 0) return
      tLastRef.current = performance.now()
      setRows((prev) => {
        const next = new Map(prev)
        for (const [k, v] of entries) next.set(k, v)
        return next
      })
      setOrder((prev) => {
        const have = new Set(prev)
        const add = entries.map(([k]) => k).filter((k) => !have.has(k))
        return add.length > 0 ? [...prev, ...add].sort(cmpKey) : prev
      })
    }

    const worker = async (): Promise<void> => {
      for (;;) {
        if (ac.signal.aborted) return
        // Nothing queued: done if the scan finished, else wait for more.
        if (queue.length === 0) {
          if (scanDone) return
          await new Promise((r) => setTimeout(r, 40))
          continue
        }
        // Budget gate: we've hydrated our allotment — pause (the appearances
        // stay queued) until "Load more" raises the budget. Stay alive; the
        // scan may also still be filling the queue.
        if (startedRef.current >= budgetRef.current) {
          await new Promise((r) => setTimeout(r, 120))
          continue
        }
        // Drain up to BATCH_SIZE appearances (within budget) and hydrate them
        // in one JSON-RPC batch.
        const batch: Appearance[] = []
        while (batch.length < BATCH_SIZE && startedRef.current < budgetRef.current) {
          const a = queue.shift()
          if (a === undefined) break
          startedRef.current += 1
          batch.push(a)
        }
        if (batch.length === 0) {
          await new Promise((r) => setTimeout(r, 40))
          continue
        }
        setStarted(startedRef.current)
        const keys = batch.map((a) => key(a.blockNumber, a.transactionIndex))

        let settled = false
        for (let attempt = 0; attempt < HYDRATE_RETRIES && !settled; attempt += 1) {
          await rpcGate.acquire(ac.signal) // global pacing + 429 backpressure
          if (ac.signal.aborted) return
          setRpcCalls((c) => c + 1) // ONE request per batch, however many txs
          try {
            const { rows: hydrated, failed, bytes } = await hydrateBatch(chain.rpcUrl, batch)
            rpcGate.reward()
            setClientExtra((c) => c + bytes)
            showSettled([
              ...hydrated.map((row): [string, TxRow] => [
                key(row.blockNumber, row.transactionIndex),
                row,
              ]),
              // Per-item failures (no tx at that index / node error) are
              // terminal — same as the old single-hydrate path.
              ...failed.map((a): [string, 'error'] => [
                key(a.blockNumber, a.transactionIndex),
                'error',
              ]),
            ])
            settled = true
          } catch (err) {
            if (err instanceof RpcRateLimitError) {
              rpcGate.throttle(err.retryAfterMs) // slow everyone, then retry the batch
              continue
            }
            showSettled(keys.map((k): [string, 'error'] => [k, 'error'])) // hard error
            settled = true
          }
        }
        if (!settled) showSettled(keys.map((k): [string, 'error'] => [k, 'error'])) // gave up
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
      if (fresh > 0) {
        const now = performance.now()
        if (tFirstRef.current === 0) tFirstRef.current = now // end of the "finding" phase
        tLastRef.current = now
        setFound((n) => n + fresh)
      }
    }

    const go = async (): Promise<void> => {
      try {
        if (source === 'chifra') {
          // Lazy pull: learn the total from the cheap `count`, then fetch
          // coordinate pages ONLY up to the current hydration budget — never the
          // whole list for a busy address we'll show 50 of. More pages are
          // pulled when "Load more" raises the budget.
          const cursor = createChifraCursor(chifraUrl, chain, address, loadOrder, ac.signal, (b) =>
            setClientExtra((c) => c + b),
          )
          let first = true
          for (;;) {
            if (ac.signal.aborted) return
            if (!scanDone && seen.size < budgetRef.current) {
              const page = await cursor.next(PAGE_SIZE)
              if (ac.signal.aborted) return
              if (cursor.total !== null) setTotal(cursor.total)
              if (first) {
                first = false
                setAppearancesDone(true) // the total is known after the first pull
              }
              onAppearances(page.appearances)
              if (page.done) scanDone = true
            } else if (scanDone) {
              break
            } else {
              // budget reached — idle until "Load more" raises it.
              await new Promise((r) => setTimeout(r, 150))
            }
          }
        } else {
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
          setAppearancesDone(true) // ① every appearance has now been emitted
          setLoadStatus(null)
          setFailures(outcome.failures)
          if (outcome.scanned) setScanned(outcome.scanned)
          scanDone = true
        }
      } catch (err) {
        scanDone = true
        if (ac.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
        setPhase('error')
        return
      }
      if (ac.signal.aborted) return
      setFeedExhausted(true) // every appearance has now been FETCHED
      // Don't await the workers: with pagination they intentionally pause at the
      // budget instead of draining; completion is derived from state below.
      void workers
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
  // In-flight hydrations (begun but not yet settled) and whether more
  // newest-first appearances remain beyond what we've started hydrating.
  const inFlight = started - hydratedCount
  // Grand total of appearances (chifra count, or all-found for backend/direct),
  // and how many we're loading RIGHT NOW (one page) — the loading bar is paced
  // against this, never the grand total, so it never reads as a stuck 50/2700.
  const grandTotal = total ?? found
  const target = Math.min(budget, grandTotal || budget)
  const moreToLoad = !feedExhausted || found > started
  const working = !appearancesDone || inFlight > 0

  // Cost timing for the metrics row: total elapsed, split into finding the
  // appearances vs hydrating them. Reads the refs each render (re-runs as rows
  // settle), so it ticks while loading and freezes when idle/done.
  const elapsedMs = (tLastRef.current || tStartRef.current) - tStartRef.current
  const findMs = (tFirstRef.current || tStartRef.current) - tStartRef.current
  const hydrateMs = Math.max(0, elapsedMs - findMs)

  // Done once every appearance has been FETCHED and hydrated.
  useEffect(() => {
    if (phase === 'error') return
    if (feedExhausted && (found === 0 || hydratedCount >= found)) setPhase('done')
  }, [phase, feedExhausted, found, hydratedCount])
  // What THIS browser actually pulled vs (backend mode) the server-side scan.
  // Direct mode: the browser does the scan, so its wire = scan + hydration.
  const clientWire = clientExtra + (source === 'direct' ? progress.bytesFetched : 0)
  const serverScan = source === 'backend' ? progress.bytesFetched : 0

  const statusLabel =
    phase === 'error'
      ? 'error'
      : phase === 'done'
        ? 'done'
        : !working
          ? 'paused'
          : source === 'chifra'
            ? 'querying'
            : loadStatus
              ? 'loading blooms'
              : 'scanning'

  const phaseNote =
    phase === 'done'
      ? source === 'chifra'
        ? `Done — loaded ${hydratedCount.toLocaleString()} of ${grandTotal.toLocaleString()} via chifra daemon.`
        : `Done — scanned ${progress.bloomsFetched.toLocaleString()} blooms, parsed ${progress.chunksFetched.toLocaleString()} chunks.`
      : source === 'chifra'
        ? grandTotal > 0
          ? `chifra: ${grandTotal.toLocaleString()} total · loaded ${hydratedCount.toLocaleString()}…`
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
          <img
            className="chain-ico"
            src={`https://gib.show/image/eip155-${chain.chainId}`}
            alt=""
            width={16}
            height={16}
          />
          <span className="load-addr">{shortAddr(address)}</span>
          <span className={`load-status load-status-${phase}`}>
            {phase === 'scanning' && working && <span className="spinner" aria-hidden="true" />}
            {statusLabel}
          </span>
          <span className="load-count">
            {grandTotal.toLocaleString()} txn{grandTotal === 1 ? '' : 's'}
          </span>
          <span className="chevron" aria-hidden="true">{collapsed ? '›' : '⌄'}</span>
        </button>
        <button type="button" className="load-close" aria-label="Remove" onClick={onRemove}>
          ✕
        </button>
      </div>

      {!collapsed && (
        <div className="load-body">
          {(phase === 'scanning' || phase === 'done') && (
            <section className="progress">
              {/* Two explicit steps so it's always clear what's loading vs done,
                  on every source (chifra has no bloom bar of its own). */}
              <div className="load-steps">
                <div className={`lstep ${appearancesDone ? 'is-done' : 'is-active'}`}>
                  <StepDot done={appearancesDone} active={!appearancesDone} />
                  <span className="lstep-label">Finding appearances</span>
                  <span className="lstep-val">
                    {grandTotal.toLocaleString()}
                    {appearancesDone ? ' found' : '…'}
                  </span>
                </div>
                <div
                  className={`lstep ${
                    target > 0 && hydratedCount >= target
                      ? 'is-done'
                      : target > 0
                        ? 'is-active'
                        : 'is-idle'
                  }`}
                >
                  <StepDot
                    done={target > 0 && hydratedCount >= target}
                    active={target > 0 && hydratedCount < target}
                  />
                  <span className="lstep-label">Loading transactions</span>
                  <span className="lstep-val">
                    {hydratedCount.toLocaleString()} / {target.toLocaleString()}
                  </span>
                </div>
                {target > 0 && (
                  <div className="progress-bar-track slim">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${Math.min(100, Math.round((hydratedCount / target) * 100))}%` }}
                    />
                  </div>
                )}
              </div>
              {source !== 'chifra' && (progress.chunksTotal > 0 || loadStatus !== null) && (
                <div className="progress-bar-track">
                  <div
                    className={`progress-bar-fill${phase === 'scanning' && pct === 0 ? ' indeterminate' : ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              {source !== 'chifra' && (progress.chunksTotal > 0 || loadStatus !== null) && (
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
                      source === 'backend'
                        ? 'Left: bytes your browser pulled (SSE stream + tx hydration). Right: bytes the server scanned from IPFS (blooms + index chunks) — NOT transferred to you.'
                        : source === 'chifra'
                          ? 'Bytes your browser pulled from the chifra daemon: the appearance list + tx hydration.'
                          : 'Bytes your browser pulled: blooms + index chunks + tx hydration.'
                    }
                  >
                    <b>{formatBytes(clientWire)}</b>
                    {source === 'backend' ? (
                      <>
                        {' / '}
                        <b>{formatBytes(serverScan)}</b>
                      </>
                    ) : null}{' '}
                    over the wire{' '}
                    <em>{source === 'backend' ? '(you / server scan)' : '(this browser)'}</em>
                  </span>
                  <span className="metric">
                    <b>{hydratedCount.toLocaleString()}</b> of {grandTotal.toLocaleString()} txns
                    hydrated
                  </span>
                  <span className="metric">
                    <b>{rpcCalls.toLocaleString()}</b> private RPC call{rpcCalls === 1 ? '' : 's'}
                  </span>
                  <span
                    className="metric metric-tip"
                    tabIndex={0}
                    data-tip={`elapsed · ${formatMs(elapsedMs)}\nfinding appearances · ${formatMs(findMs)}\nhydrating txns · ${formatMs(hydrateMs)}`}
                  >
                    <b>{formatMs(elapsedMs)}</b> elapsed
                  </span>
                </div>
                {phase === 'done' && <p className="phase-note">{phaseNote}</p>}
              </section>
            )}

          {error && (
            <div className="panel error">
              <h3>Couldn’t complete the lookup</h3>
              {error}
            </div>
          )}

          {order.length > 0 && (
            <ResultsTable
              chain={chain}
              self={address.toLowerCase()}
              order={order}
              rows={rows}
              total={grandTotal}
              initialDesc={loadOrder === 'newest'}
            />
          )}

          {moreToLoad && (
            <div className="load-more-row">
              <button
                type="button"
                className="load-more-btn"
                onClick={() => setBudget((b) => b + PAGE_SIZE)}
                disabled={inFlight > 0}
              >
                {inFlight > 0 ? 'Loading…' : `Load ${PAGE_SIZE} more`}
              </button>
              <span className="load-more-note">
                {hydratedCount.toLocaleString()} of {grandTotal.toLocaleString()} loaded
              </span>
            </div>
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

/** Per-step status glyph: spinner while active, green check when done, hollow dot when idle. */
const StepDot = ({ done, active }: { done: boolean; active: boolean }) =>
  done ? (
    <span className="lstep-dot done" aria-hidden="true">✓</span>
  ) : active ? (
    <span className="spinner" aria-hidden="true" />
  ) : (
    <span className="lstep-dot idle" aria-hidden="true" />
  )

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
