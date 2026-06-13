import { useEffect, useRef, useState } from 'react'
import { isReservedAddress } from '@valve-tech/unchained-reader'

import { CHAINS, type ChainConfig } from './config'
import { isAddressLike } from './lib/format'
import { detectChain, loadCustomChains, saveCustomChains } from './lib/chains'
import { LoadCard, type LoadParams } from './components/LoadCard'

// One-click sample, only where it lands inside the default "recent chunks"
// scope and stays cheap. 943 is verified against the live chain. 369 /
// mainnet are omitted on purpose (their recent chunks are large) — paste
// your own. The reader itself works identically on all three chains.
const SAMPLES: Record<number, string> = {
  943: '0x002c67e5f1d6eec758e1ec02087f2e63c869d18c',
}

export const App = () => {
  const [chains, setChains] = useState<ChainConfig[]>(() => [...CHAINS, ...loadCustomChains()])
  const [chain, setChain] = useState<ChainConfig>(CHAINS[0])
  const [address, setAddress] = useState('')
  const [fullHistory, setFullHistory] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loads, setLoads] = useState<LoadParams[]>([])
  const nextId = useRef(1)

  // Paste any EVM RPC → detect its chain id → name/symbol/explorer from viem,
  // icon from gib.show. If the id matches a built-in indexed chain it inherits
  // the index keys (so chifra/Unchained still work) and just swaps the RPC.
  const addCustomRpc = async (rpcUrl: string): Promise<void> => {
    const detected = await detectChain(rpcUrl)
    setChains((prev) => {
      const next = [
        ...prev.filter((c) => !(c.chainId === detected.chainId && c.rpcUrl === detected.rpcUrl)),
        detected,
      ]
      saveCustomChains(next.filter((c) => !CHAINS.includes(c)))
      return next
    })
    setChain(detected)
  }

  // Each search "cuts off" into its own card without disturbing the ones
  // already loading/loaded — newest first.
  const submit = (): void => {
    const addr = address.trim()
    if (!isAddressLike(addr)) {
      setError('Enter a valid 20-byte address (0x + 40 hex characters).')
      return
    }
    if (isReservedAddress(addr)) {
      setError(
        'Addresses ≤ 0xffff are precompiles / the reserved range — chifra doesn’t index them. Try a real account or contract.',
      )
      return
    }
    setError(null)
    const id = nextId.current
    nextId.current += 1
    setLoads((prev) => [{ id, chain, address: addr, fullHistory }, ...prev])
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') submit()
  }

  return (
    <div className="wrap">
      <header className="masthead">
        <p className="eyebrow">Taggings in the city · valve.city</p>
        <h1>
          Every address leaves <span className="chain-dim">tags</span> all over the chain.
        </h1>
        <p className="lede">
          Type one in. We pull up its “taggings” — every transaction it shows up in — straight off
          the TrueBlocks{' '}
          <a href="https://trueblocks.io" target="_blank" rel="noreferrer">
            Unchained Index
          </a>
          : manifest resolved live from chain, bloom filters and index chunks pulled from IPFS and
          parsed <em>in your browser</em> with <code>@valve-tech/unchained-reader</code> — no API
          key, no chifra daemon. Swap the RPC and gateway for your own and nothing here depends on
          valve.
        </p>
      </header>

      <section className="controls">
        <div className="search-row" role="group">
          <ChainMenu
            chain={chain}
            chains={chains}
            onSelect={setChain}
            onAddRpc={addCustomRpc}
          />
          <div className="addr-wrap">
            <input
              className="addr-input"
              placeholder="0x… address"
              value={address}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <label
              className="history-toggle"
              data-tip={
                fullHistory
                  ? 'Searching ALL history — every chunk (slower). Toggle off for recent chunks only.'
                  : 'Recent chunks only. Toggle on to search all history (slower).'
              }
            >
              <input
                type="checkbox"
                checked={fullHistory}
                onChange={(e) => setFullHistory(e.target.checked)}
                aria-label="Search all history"
              />
              <span className="switch" aria-hidden="true" />
            </label>
          </div>
          <button className="go-btn" onClick={submit}>
            Verify
          </button>
        </div>

        {SAMPLES[chain.chainId] && (
          <div className="opts-row">
            <button className="sample-btn" onClick={() => setAddress(SAMPLES[chain.chainId])}>
              try a sample address
            </button>
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
      </section>

      {loads.length > 0 && (
        <section className="loads">
          {loads.map((l) => (
            <LoadCard
              key={l.id}
              params={l}
              onRemove={() => setLoads((prev) => prev.filter((x) => x.id !== l.id))}
            />
          ))}
        </section>
      )}

      <footer className="colophon">
        Built on <code>@valve-tech/unchained-reader</code> — the binary bloom/chunk parsers run
        client-side. Index chunks served from <code>ipfs.valve.city</code>; manifests resolved
        on-chain from the permissionless UnchainedIndex contract; transactions hydrated over public
        JSON-RPC. Part of the{' '}
        <a href="https://github.com/valve-tech/evm-toolkit" target="_blank" rel="noreferrer">
          valve-tech/evm-toolkit
        </a>
        .
      </footer>
    </div>
  )
}

/** Chain dropdown for the search row — built-in + user-added custom RPCs. */
const ChainMenu = ({
  chain,
  chains,
  onSelect,
  onAddRpc,
}: {
  chain: ChainConfig
  chains: ChainConfig[]
  onSelect: (c: ChainConfig) => void
  onAddRpc: (rpcUrl: string) => Promise<void>
}) => {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [rpc, setRpc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const submitRpc = async (): Promise<void> => {
    if (!rpc.trim() || busy) return
    setBusy(true)
    setErr(null)
    try {
      await onAddRpc(rpc)
      setAdding(false)
      setRpc('')
      setOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chain-menu" ref={ref}>
      <button
        type="button"
        className="chain-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <img
          className="chain-ico"
          src={`https://gib.show/image/eip155-${chain.chainId}`}
          alt=""
          width={18}
          height={18}
        />
        <span className="chain-name">{chain.label}</span>
        <span className="chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <ul className="chain-list" role="listbox">
          {chains.map((c) => (
            <li key={`${c.chainId}-${c.rpcUrl}`} role="option" aria-selected={c === chain}>
              <button
                type="button"
                className="chain-option"
                onClick={() => {
                  onSelect(c)
                  setOpen(false)
                }}
              >
                <img
                  className="chain-ico"
                  src={`https://gib.show/image/eip155-${c.chainId}`}
                  alt=""
                  width={18}
                  height={18}
                />
                <span>{c.label}</span>
                {!c.chainKey && (
                  <span className="chain-noindex" title="No Unchained Index for this chain — hydration only">
                    no index
                  </span>
                )}
              </button>
            </li>
          ))}
          <li className="chain-add">
            {adding ? (
              <div className="chain-add-form">
                <input
                  className="chain-add-input"
                  placeholder="https://your-rpc.example…"
                  value={rpc}
                  spellCheck={false}
                  autoFocus
                  disabled={busy}
                  onChange={(e) => setRpc(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRpc()
                  }}
                />
                <button
                  type="button"
                  className="chain-add-go"
                  disabled={busy}
                  onClick={() => void submitRpc()}
                >
                  {busy ? '…' : 'Add'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="chain-option chain-add-btn"
                onClick={() => setAdding(true)}
              >
                + Custom RPC…
              </button>
            )}
            {err && <div className="chain-add-err">{err}</div>}
          </li>
        </ul>
      )}
    </div>
  )
}
