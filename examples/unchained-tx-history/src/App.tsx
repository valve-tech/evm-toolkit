import { useEffect, useRef, useState } from 'react'
import { isReservedAddress } from '@valve-tech/unchained-reader'

import { CHAINS, type ChainConfig } from './config'
import { isAddressLike } from './lib/format'
import { LoadCard, type LoadParams } from './components/LoadCard'

// One-click sample, only where it lands inside the default "recent chunks"
// scope and stays cheap. 943 is verified against the live chain. 369 /
// mainnet are omitted on purpose (their recent chunks are large) — paste
// your own. The reader itself works identically on all three chains.
const SAMPLES: Record<number, string> = {
  943: '0x002c67e5f1d6eec758e1ec02087f2e63c869d18c',
}

export const App = () => {
  const [chain, setChain] = useState<ChainConfig>(CHAINS[0])
  const [address, setAddress] = useState('')
  const [fullHistory, setFullHistory] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loads, setLoads] = useState<LoadParams[]>([])
  const nextId = useRef(1)

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
          <ChainMenu chain={chain} onSelect={setChain} />
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

/** Compact chain dropdown that sits inline in the search row. */
const ChainMenu = ({
  chain,
  onSelect,
}: {
  chain: ChainConfig
  onSelect: (c: ChainConfig) => void
}) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

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
          {CHAINS.map((c) => (
            <li key={c.chainId} role="option" aria-selected={c.chainId === chain.chainId}>
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
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
