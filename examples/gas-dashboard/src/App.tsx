import { useEffect, useMemo, useRef, useState } from 'react'
import type { Capabilities } from '@valve-tech/chain-source'
import type { GasOracleState, TipSample } from '@valve-tech/gas-oracle'

import { CHAINS, type ChainConfig } from './config'
import { detectChain, loadCustomChains, saveCustomChains } from './lib/chains'
import { createDashboard, type Dashboard } from './lib/dashboard'
import { derivePanelState, type PanelState } from './lib/capabilities'
import { bucketTips } from './lib/histogram'
import { formatWei } from './lib/format'
import { Sparkline } from './components/Sparkline'
import { Histogram } from './components/Histogram'
import { TiersRow } from './components/TiersRow'
import { PositionEstimator } from './components/PositionEstimator'
import { CapabilityPanel } from './components/CapabilityPanel'
import { Banner } from './components/Banner'

const HISTOGRAM_BUCKETS = 24

export const App = (): JSX.Element => {
  const [custom] = useState<ChainConfig[]>(() => loadCustomChains())
  const allChains = useMemo(() => [...CHAINS, ...custom], [custom])
  const [chain, setChain] = useState<ChainConfig>(CHAINS[0])
  const [state, setState] = useState<GasOracleState | null>(null)
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rpcInput, setRpcInput] = useState('')
  const [detecting, setDetecting] = useState(false)
  const dashRef = useRef<Dashboard | null>(null)

  // Build/teardown the pipeline whenever the selected chain changes.
  useEffect(() => {
    setState(null)
    setCaps(null)
    setError(null)
    const dash = createDashboard(chain, {
      onState: setState,
      onCapabilities: setCaps,
      onError: (e) => setError(e.message),
    })
    dashRef.current = dash
    return () => dash.dispose()
  }, [chain])

  const panel: PanelState = useMemo(
    () =>
      caps
        ? derivePanelState(caps)
        : {
            mempoolEnabled: false,
            mempoolReason: 'probing capabilities…',
            blockPositionMode: 'block-included',
            transport: 'http-poll',
            badges: [],
          },
    [caps],
  )

  // Distribution for the estimator: mempool samples when available, else the
  // block-included tips from the ring.
  const estimatorSamples: TipSample[] = useMemo(() => {
    if (!state) return []
    return panel.blockPositionMode === 'mempool' && state.mempoolSamples.length > 0
      ? state.mempoolSamples
      : state.ring.flatMap((b) => b.tips)
  }, [state, panel.blockPositionMode])

  const histogram = useMemo(() => {
    if (!state) return null
    const cutoffs = {
      slow: state.tiers.slow.maxPriorityFeePerGas,
      standard: state.tiers.standard.maxPriorityFeePerGas,
      fast: state.tiers.fast.maxPriorityFeePerGas,
      instant: state.tiers.instant.maxPriorityFeePerGas,
    }
    return bucketTips(state.mempoolSamples, HISTOGRAM_BUCKETS, cutoffs)
  }, [state])

  const onDetect = async (): Promise<void> => {
    if (!rpcInput.trim()) return
    setDetecting(true)
    setError(null)
    try {
      const detected = await detectChain(rpcInput)
      const next = [...custom.filter((c) => c.rpcUrl !== detected.rpcUrl), detected]
      saveCustomChains(next)
      setChain(detected)
      setRpcInput('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDetecting(false)
    }
  }

  return (
    <>
      <header>
        <strong>⛽ gas monitor</strong>
        <select
          value={chain.rpcUrl}
          onChange={(e) => {
            const next = allChains.find((c) => c.rpcUrl === e.target.value)
            if (next) setChain(next)
          }}
        >
          {allChains.map((c) => (
            <option key={c.rpcUrl} value={c.rpcUrl}>
              {c.label} ({c.chainId})
            </option>
          ))}
        </select>
        <input
          placeholder="paste an http(s) RPC…"
          value={rpcInput}
          onChange={(e) => setRpcInput(e.target.value)}
        />
        <button onClick={() => void onDetect()} disabled={detecting}>
          {detecting ? 'detecting…' : 'add RPC'}
        </button>
        <span className="muted">
          block {state ? formatWei(state.blockNumber) : '—'}
        </span>
        {panel.badges.map((b) => (
          <span key={b.id} className={b.on ? 'badge' : 'badge off'} title={b.detail}>
            {b.label}
          </span>
        ))}
      </header>

      {error && <Banner message={`RPC error: ${error}`} />}

      {!state ? (
        <p className="muted" style={{ padding: '1rem' }}>
          Connecting to {chain.label} and waiting for the first block…
        </p>
      ) : (
        <>
          <TiersRow tiers={state.tiers} />
          <section className="grid-2x2">
            <div className="panel">
              <h3>Base-fee trend</h3>
              <Sparkline history={state.baseFeeHistory} />
            </div>
            <div className="panel">
              <h3>Mempool tip histogram</h3>
              {panel.mempoolEnabled && histogram ? (
                <Histogram data={histogram} />
              ) : (
                <p className="muted">{panel.mempoolReason}</p>
              )}
            </div>
            <PositionEstimator samples={estimatorSamples} mode={panel.blockPositionMode} />
            <CapabilityPanel caps={caps} panel={panel} state={state} />
          </section>
        </>
      )}
    </>
  )
}
