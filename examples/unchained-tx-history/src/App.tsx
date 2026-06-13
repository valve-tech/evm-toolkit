import { useCallback, useMemo, useRef, useState } from 'react'
import type { Progress, ChunkFailure } from '@valve-tech/unchained-reader'

import { CHAINS, DEFAULT_RECENT_CHUNKS, type ChainConfig } from './config'
import { queryHistory } from './lib/history'
import { hydrate, type TxRow } from './lib/rpc'
import { isAddressLike, shortAddr, shortHash } from './lib/format'
import { ResultsTable } from './components/ResultsTable'

// One-click sample, only where it lands inside the default "recent
// chunks" scope and stays cheap. 943 is verified against the live chain
// (appears as `to` in chunk 024250260-024500000). 369 / mainnet are
// omitted on purpose: their recent chunks are ~20 MB each, so a sample
// must be a low-appearance address — paste your own. The reader itself
// works identically on all three chains.
const SAMPLES: Record<number, string> = {
  943: '0x002c67e5f1d6eec758e1ec02087f2e63c869d18c',
}

type Phase = 'idle' | 'scanning' | 'hydrating' | 'done' | 'error'

const HYDRATE_CONCURRENCY = 4
// The public vk_demo endpoint is rate-limited to ~5 req/s per IP. Bounding
// concurrency isn't enough (4 fast requests still burst past 5/s), so we
// pace the *start* of each hydration ~220ms apart (~4.5 req/s).
const HYDRATE_MIN_INTERVAL_MS = 220

const emptyProgress: Progress = {
  chunksTotal: 0,
  bloomsFetched: 0,
  hits: 0,
  chunksFetched: 0,
  appearancesFound: 0,
}

export const App = () => {
  const [chain, setChain] = useState<ChainConfig>(CHAINS[0])
  const [address, setAddress] = useState('')
  const [fullHistory, setFullHistory] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<Progress>(emptyProgress)
  const [rows, setRows] = useState<Map<string, TxRow | 'pending' | 'error'>>(new Map())
  const [order, setOrder] = useState<string[]>([])
  const [failures, setFailures] = useState<ChunkFailure[]>([])
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const busy = phase === 'scanning' || phase === 'hydrating'
  const key = (b: bigint, t: bigint): string => `${b}:${t}`

  const run = useCallback(async () => {
    const addr = address.trim()
    if (!isAddressLike(addr)) {
      setError('Enter a valid 20-byte address (0x + 40 hex characters).')
      setPhase('error')
      return
    }
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setError(null)
    setFailures([])
    setRows(new Map())
    setOrder([])
    setProgress(emptyProgress)
    setPhase('scanning')

    try {
      const { result } = await queryHistory(
        chain,
        addr,
        { fullHistory },
        (p) => setProgress(p),
        ac.signal,
      )
      if (ac.signal.aborted) return
      setFailures(result.failures)

      // Seed the table with appearances (block + index known immediately).
      const seedOrder = result.appearances.map((a) => key(a.blockNumber, a.transactionIndex))
      const seed = new Map<string, TxRow | 'pending' | 'error'>()
      seedOrder.forEach((k) => seed.set(k, 'pending'))
      setOrder(seedOrder)
      setRows(new Map(seed))

      if (result.appearances.length === 0) {
        setPhase('done')
        return
      }
      setPhase('hydrating')

      // Hydrate tx details with a small concurrency pool, updating rows live.
      // A shared rate gate paces request starts under the vk_demo limit.
      const queue = [...result.appearances]
      let nextSlot = 0
      const acquireSlot = async (): Promise<void> => {
        const now = Date.now()
        const wait = Math.max(0, nextSlot - now)
        nextSlot = Math.max(now, nextSlot) + HYDRATE_MIN_INTERVAL_MS
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      }
      const worker = async (): Promise<void> => {
        while (queue.length > 0 && !ac.signal.aborted) {
          const app = queue.shift()!
          const k = key(app.blockNumber, app.transactionIndex)
          await acquireSlot()
          if (ac.signal.aborted) return
          try {
            const row = await hydrate(chain.rpcUrl, app)
            setRows((prev) => new Map(prev).set(k, row))
          } catch {
            setRows((prev) => new Map(prev).set(k, 'error'))
          }
        }
      }
      await Promise.all(Array.from({ length: HYDRATE_CONCURRENCY }, worker))
      if (!ac.signal.aborted) setPhase('done')
    } catch (err) {
      if (ac.signal.aborted) return
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }, [address, chain, fullHistory])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !busy) run()
  }

  const pct = useMemo(() => {
    if (progress.chunksTotal === 0) return 0
    return Math.round((progress.bloomsFetched / progress.chunksTotal) * 100)
  }, [progress])

  return (
    <div className="wrap">
      <header className="masthead">
        <p className="eyebrow">⛓ valve.city · unchained index</p>
        <h1>
          Transaction history,{' '}
          <span className="chain-dim">read trustlessly from your browser.</span>
        </h1>
        <p className="lede">
          Type any address. This page resolves the TrueBlocks{' '}
          <a href="https://trueblocks.io" target="_blank" rel="noreferrer">
            Unchained Index
          </a>{' '}
          manifest live from chain, pulls bloom filters and index chunks from IPFS, and
          parses them <em>in your browser</em> with{' '}
          <code>@valve-tech/unchained-reader</code> — no backend, no API key, no chifra
          daemon. Swap the RPC and gateway for your own and nothing here depends on valve.
        </p>
      </header>

      <section className="controls">
        <div className="chain-tabs" role="group" aria-label="Chain">
          {CHAINS.map((c) => (
            <button
              key={c.chainId}
              className="chain-tab"
              aria-pressed={c.chainId === chain.chainId}
              onClick={() => setChain(c)}
              disabled={busy}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="search-row">
          <input
            className="addr-input"
            placeholder="0x… address"
            value={address}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="go-btn" onClick={run} disabled={busy}>
            {busy ? 'Scanning…' : 'Trace'}
          </button>
        </div>

        <div className="opts-row">
          <label title="By default only the most recent chunks are scanned. Full history can be hundreds of MB of bloom fetches on mainnet.">
            <input
              type="checkbox"
              checked={fullHistory}
              disabled={busy}
              onChange={(e) => setFullHistory(e.target.checked)}
            />
            Search all history (slower){fullHistory ? '' : ` · default: last ${DEFAULT_RECENT_CHUNKS} chunks`}
          </label>
          {SAMPLES[chain.chainId] && (
            <button
              className="sample-btn"
              disabled={busy}
              onClick={() => setAddress(SAMPLES[chain.chainId])}
            >
              try a sample address
            </button>
          )}
        </div>
      </section>

      {(busy || phase === 'done') && progress.chunksTotal > 0 && (
        <section className="progress">
          <div className="progress-bar-track">
            <div
              className={`progress-bar-fill${phase === 'scanning' && pct === 0 ? ' indeterminate' : ''}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="stat-grid">
            <Stat n={progress.chunksTotal} k="chunks in scope" />
            <Stat n={progress.bloomsFetched} k="blooms read" />
            <Stat n={progress.hits} k="bloom hits" accent />
            <Stat n={progress.chunksFetched} k="chunks parsed" />
            <Stat n={progress.appearancesFound} k="appearances" accent />
          </div>
          <p className="phase-note">
            {phase === 'scanning' && 'Resolving manifest · fetching blooms · gating chunks…'}
            {phase === 'hydrating' && 'Appearances found. Hydrating transaction details over JSON-RPC…'}
            {phase === 'done' && `Done — scanned ${progress.bloomsFetched} blooms, parsed ${progress.chunksFetched} chunks.`}
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
        <ResultsTable chain={chain} self={address.trim().toLowerCase()} order={order} rows={rows} />
      )}

      {phase === 'done' && order.length === 0 && !error && (
        <div className="panel empty">
          No appearances found for {shortAddr(address.trim())} in{' '}
          {fullHistory ? 'the full index' : `the last ${DEFAULT_RECENT_CHUNKS} chunks`} of {chain.label}.
          {!fullHistory && ' Try “search all history”.'}
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
                blocks {f.range.first.toString()}–{f.range.last.toString()} · {f.reason} ·{' '}
                {shortHash(f.cid, 8, 6)}
              </li>
            ))}
            {failures.length > 6 && <li>…and {failures.length - 6} more</li>}
          </ul>
        </div>
      )}

      <footer className="colophon">
        Built on <code>@valve-tech/unchained-reader</code> — the binary bloom/chunk parsers run
        client-side. Index chunks served from <code>ipfs.valve.city</code>; manifests resolved
        on-chain from the permissionless UnchainedIndex contract; transactions hydrated over
        public JSON-RPC. Part of the{' '}
        <a href="https://github.com/valve-tech/evm-toolkit" target="_blank" rel="noreferrer">
          valve-tech/evm-toolkit
        </a>
        .
      </footer>
    </div>
  )
}

const Stat = ({ n, k, accent }: { n: number; k: string; accent?: boolean }) => (
  <div className="stat">
    <div className={`n${accent ? ' accent' : ''}`}>{n.toLocaleString()}</div>
    <div className="k">{k}</div>
  </div>
)
