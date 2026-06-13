/**
 * One self-contained query "load". Runs (and streams) ONCE on mount, owns
 * all of its own state, and renders as a collapsible card. The App keeps a
 * list of these — newest first — so every search becomes its own history
 * row that keeps its results while later searches run alongside it.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Appearance, Progress } from '@valve-tech/unchained-reader'

import { BACKEND_URL, DEFAULT_RECENT_CHUNKS, type ChainConfig } from '../config'
import { queryHistory, type QueryFailure, type StreamQuery } from '../lib/history'
import { queryViaBackend } from '../lib/backend'
import { hydrate, type TxRow } from '../lib/rpc'
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

const HYDRATE_CONCURRENCY = 4
// vk_demo is ~5 req/s per IP; pace hydration starts ~220ms apart (~4.5/s).
const HYDRATE_MIN_INTERVAL_MS = 220

const emptyProgress: Progress = {
  chunksTotal: 0,
  bloomsFetched: 0,
  hits: 0,
  chunksFetched: 0,
  appearancesFound: 0,
  bytesFetched: 0,
}

const querySource: StreamQuery = BACKEND_URL ? queryViaBackend : queryHistory

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
  const [rpcCalls, setRpcCalls] = useState(BACKEND_URL ? 0 : 1)

  // Run the query exactly once, on mount. Abort on unmount.
  useEffect(() => {
    const ac = new AbortController()
    const queue: Appearance[] = []
    const seen = new Set<string>()
    let scanDone = false
    let nextSlot = 0

    const acquireSlot = async (): Promise<void> => {
      const now = Date.now()
      const wait = Math.max(0, nextSlot - now)
      nextSlot = Math.max(now, nextSlot) + HYDRATE_MIN_INTERVAL_MS
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    }
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
        await acquireSlot()
        if (ac.signal.aborted) return
        setRpcCalls((c) => c + 1)
        try {
          const row = await hydrate(chain.rpcUrl, app)
          setRows((prev) => new Map(prev).set(k, row))
        } catch {
          setRows((prev) => new Map(prev).set(k, 'error'))
        }
      }
    }
    const workers = Array.from({ length: HYDRATE_CONCURRENCY }, worker)

    const onAppearances = (found: Appearance[]): void => {
      const fresh: string[] = []
      for (const a of found) {
        const k = key(a.blockNumber, a.transactionIndex)
        if (seen.has(k)) continue
        seen.add(k)
        fresh.push(k)
        queue.push(a)
      }
      if (fresh.length === 0) return
      setOrder((prev) => [...prev, ...fresh].sort(cmpKey))
      setRows((prev) => {
        const next = new Map(prev)
        fresh.forEach((k) => next.set(k, 'pending'))
        return next
      })
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

  const statusLabel =
    phase === 'error' ? 'error' : phase === 'done' ? 'done' : loadStatus ? 'loading blooms' : 'scanning'

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
            {order.length.toLocaleString()} txn{order.length === 1 ? '' : 's'}
          </span>
        </button>
        <button type="button" className="load-close" aria-label="Remove" onClick={onRemove}>
          ✕
        </button>
      </div>

      {!collapsed && (
        <div className="load-body">
          {(phase === 'scanning' || phase === 'done') &&
            (progress.chunksTotal > 0 || loadStatus !== null) && (
              <section className="progress">
                <div className="progress-bar-track">
                  <div
                    className={`progress-bar-fill${phase === 'scanning' && pct === 0 ? ' indeterminate' : ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="stat-grid">
                  <Stat n={progress.chunksTotal} k="chunks in scope" tip="Index chunks inside the searched range — the address can only appear within these. Each chunk is one small bloom filter + one larger index file on IPFS." />
                  <Stat n={progress.bloomsFetched} k="blooms read" tip="Bloom filters downloaded — one per chunk in scope. Every bloom must be fetched to test it, so this rises to equal the chunks in scope." />
                  <Stat n={progress.hits} k="bloom hits" accent tip="Chunks whose bloom says the address MIGHT be inside. Only these get a full (larger) index download. Blooms can false-positive, so a hit is a maybe." />
                  <Stat n={progress.chunksFetched} k="chunks parsed" tip="Index files actually downloaded and parsed — one per bloom hit. These hold the authoritative list of the address's appearances." />
                  <Stat n={progress.appearancesFound} k="appearances" accent tip="Confirmed (block, transaction-index) appearances found in the parsed indexes. Each becomes a row in the table below." />
                </div>
                <div className="metrics">
                  <span className="metric">
                    <b>{formatBytes(progress.bytesFetched)}</b> over the wire{' '}
                    <em>{BACKEND_URL ? '(server-side scan)' : '(this browser)'}</em>
                  </span>
                  <span className="metric">
                    <b>{hydratedCount.toLocaleString()}</b> of {order.length.toLocaleString()} txns
                    hydrated
                  </span>
                  <span className="metric">
                    <b>{rpcCalls.toLocaleString()}</b> private RPC call{rpcCalls === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="phase-note">
                  {phase === 'scanning' && loadStatus
                    ? `Loading blooms into memory — ${loadStatus.done.toLocaleString()}/` +
                      `${loadStatus.total.toLocaleString()} (first query for this chain)…`
                    : phase === 'scanning'
                      ? `Streaming — ${progress.bloomsFetched}/${progress.chunksTotal} blooms scanned · ` +
                        `${progress.appearancesFound} appearance${progress.appearancesFound === 1 ? '' : 's'} so far…`
                      : `Done — scanned ${progress.bloomsFetched} blooms, parsed ${progress.chunksFetched} chunks.`}
                </p>
              </section>
            )}

          {error && (
            <div className="panel error">
              <h3>Couldn’t complete the trace</h3>
              {error}
            </div>
          )}

          {order.length > 0 && (
            <ResultsTable chain={chain} self={address.toLowerCase()} order={order} rows={rows} />
          )}

          {phase === 'done' && order.length === 0 && !error && (
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
