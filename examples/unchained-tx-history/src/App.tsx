import { useEffect, useRef, useState } from 'react'
import { isReservedAddress } from '@valve-tech/unchained-reader'

import { CHAINS, CHIFRA_URL, type ChainConfig } from './config'
import { isAddressLike } from './lib/format'
import { detectChain, loadCustomChains, saveCustomChains } from './lib/chains'
import { LoadCard, type LoadParams } from './components/LoadCard'
import { CorridorBackground } from './components/CorridorBackground'
import type { SortOrder } from './lib/cursor'

// One-click sample, only where it lands inside the default "recent chunks"
// scope and stays cheap. 943 is verified against the live chain. 369 /
// mainnet are omitted on purpose (their recent chunks are large) — paste
// your own. The reader itself works identically on all three chains.
const SAMPLES: Record<number, string> = {
  943: '0x002c67e5f1d6eec758e1ec02087f2e63c869d18c',
}

// The selected chifra daemon URL, persisted. `null` (never set) → valve default;
// '' → trustless (no daemon); anything else → a custom daemon.
const CHIFRA_KEY = 'unchained-tx-history.chifra'
const loadChifraUrl = (): string => {
  try {
    const v = localStorage.getItem(CHIFRA_KEY)
    return v === null ? CHIFRA_URL : v
  } catch {
    return CHIFRA_URL
  }
}
const saveChifraUrl = (url: string): void => {
  try {
    localStorage.setItem(CHIFRA_KEY, url)
  } catch {
    /* private mode / quota — stays in-memory for the session */
  }
}

export const App = () => {
  const [chains, setChains] = useState<ChainConfig[]>(() => [...CHAINS, ...loadCustomChains()])
  const [chain, setChain] = useState<ChainConfig>(CHAINS[0])
  const [address, setAddress] = useState('')
  const [fullHistory, setFullHistory] = useState(true)
  const [order, setOrder] = useState<SortOrder>('newest')
  // The chifra daemon serving appearances is swappable at runtime (default
  // valve's; '' = trustless browser scan). Persisted across visits.
  const [chifraUrl, setChifraUrl] = useState<string>(loadChifraUrl)
  const [error, setError] = useState<string | null>(null)
  const [loads, setLoads] = useState<LoadParams[]>([])
  const nextId = useRef(1)
  const accSlotRef = useRef<HTMLSpanElement>(null)
  const accReelRef = useRef<HTMLSpanElement>(null)
  const { theme, toggleTheme } = useTheme()

  // One-time headline flourish: lock the accent word to its resting (graffiti
  // Permanent Marker) width so the line can never reflow, then "spray" it —
  // reel through the other graffiti faces for ~0.9s and settle back on the
  // resting face. The width lock is what keeps the rest of the headline from
  // jumping as font widths change.
  useEffect(() => {
    const slot = accSlotRef.current
    const reel = accReelRef.current
    if (!slot || !reel) return
    let iv: ReturnType<typeof setInterval> | undefined
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (cancelled || !slot || !reel) return
      const rect = reel.getBoundingClientRect()
      slot.style.width = `${Math.ceil(rect.width)}px`
      // Lock the HEIGHT too. The slot is an inline-block; without a fixed height
      // it sizes to its content's line box, so swapping the reel to a taller
      // graffiti face grew the slot and pushed the copy below it down the page.
      // With the box height pinned, tall faces overflow visibly (overflow is
      // visible) but can no longer move anything. Width lock alone wasn't enough.
      slot.style.height = `${Math.ceil(rect.height)}px`
      // Pull the reel OUT of flow now that the slot box is locked. With no
      // in-flow content, the slot's baseline is its fixed bottom edge — so the
      // surrounding "gets" no longer rides up/down as the reel font changes.
      // The reel is centred in the rigid box and free to overflow it visibly.
      reel.style.position = 'absolute'
      reel.style.left = '50%'
      reel.style.bottom = '0'
      reel.style.transform = 'translateX(-50%)'
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      let t = 0
      iv = setInterval(() => {
        reel.style.fontFamily = GFONTS[Math.floor(Math.random() * GFONTS.length)]
        t += 70
        if (t >= 900) {
          if (iv) clearInterval(iv)
          reel.style.fontFamily = '' // settle back to the resting graffiti face
        }
      }, 70)
    })
    return () => {
      cancelled = true
      if (iv) clearInterval(iv)
    }
  }, [])

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
    setLoads((prev) => [{ id, chain, address: addr, fullHistory, chifraUrl, order }, ...prev])
  }

  const selectChifra = (url: string): void => {
    setChifraUrl(url)
    saveChifraUrl(url)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') submit()
  }

  return (
    <>
      <GraffitiBackground />
      <div className="graffiti-scrim" aria-hidden="true" />
      <div className="wrap">
      <header className="masthead">
        <p className="eyebrow">Tagged in the city</p>
        <h1>
          Every address gets{' '}
          <span className="chain-dim acc-slot" ref={accSlotRef}>
            <span className="acc-reel" ref={accReelRef}>tagged</span>
          </span>
        </h1>
        <p className="lede">
          Type one in. We pull up its tags — every transaction it shows up in, off the
          TrueBlocks{' '}
          <a href="https://trueblocks.io" target="_blank" rel="noreferrer">
            Unchained Index
          </a>
          . No backend, no API key — point it at your own node and nothing depends on valve.
        </p>
      </header>

      <section className="controls">
        <div className="menu-row">
          <ChifraMenu value={chifraUrl} onChange={selectChifra} />
          <ChainMenu
            chain={chain}
            chains={chains}
            onSelect={setChain}
            onAddRpc={addCustomRpc}
          />
        </div>
        <div className="search-row" role="group">
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
          <div className="go-group">
            <button className="go-btn" onClick={submit}>
              Search
            </button>
            <OrderMenu order={order} onChange={setOrder} />
          </div>
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

      <section className="howto">
        <p className="eyebrow">How it works</p>
        <h2 className="howto-title">Load this same data yourself.</h2>
        <p className="howto-intro">
          No API key, no backend, no database — just public infrastructure. Here is the whole
          pipeline this page runs.
        </p>
        <ol className="howto-steps">
          <li>
            <span className="howto-n">01</span>
            <div>
              <h3>Resolve the index, live from chain</h3>
              <p>
                The TrueBlocks{' '}
                <a href="https://trueblocks.io" target="_blank" rel="noreferrer">
                  Unchained Index
                </a>{' '}
                is published permissionlessly — one manifest CID per chain, written to the{' '}
                <code>UnchainedIndex</code> contract on Ethereum. Read{' '}
                <code>manifestHashMap(publisher, chainKey)</code> and you hold the current index,
                never a stale baked-in value.
              </p>
            </div>
          </li>
          <li>
            <span className="howto-n">02</span>
            <div>
              <h3>Find where the address appears</h3>
              <p>
                Fast path: ask a <code>chifra</code> daemon&rsquo;s <code>/list</code> — it has the
                index parsed on disk and returns every <code>(block, tx-index)</code> the address
                shows up in. Trustless path: pull the manifest&rsquo;s bloom filters + index chunks
                from any IPFS gateway and scan them in the browser with{' '}
                <code>@valve-tech/unchained-reader</code> — the blooms decide which chunks are even
                worth downloading.
              </p>
            </div>
          </li>
          <li>
            <span className="howto-n">03</span>
            <div>
              <h3>Hydrate each appearance</h3>
              <p>
                For every appearance, call <code>eth_getTransactionByBlockNumberAndIndex</code> over
                plain JSON-RPC — batched ~16 to a request. Any node works; bring your own and
                nothing depends on valve.
              </p>
            </div>
          </li>
          <li>
            <span className="howto-n">04</span>
            <div>
              <h3>That&rsquo;s the whole thing</h3>
              <p>
                No server, no key. Every endpoint lives in <code>src/config.ts</code> — point{' '}
                <code>CHIFRA_URL</code>, <code>IPFS_GATEWAY</code> and the per-chain{' '}
                <code>rpcUrl</code> at your own infra and you have this page.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <footer className="colophon">
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          <span className="ico" aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        Appearances from a TrueBlocks <code>chifra</code> daemon by default — or, fully trustless,
        the browser bloom-scans the permissionless UnchainedIndex from any IPFS gateway with{' '}
        <code>@valve-tech/unchained-reader</code>. Transactions are hydrated client-side over
        batched public JSON-RPC. Part of the{' '}
        <a href="https://github.com/valve-tech/evm-toolkit" target="_blank" rel="noreferrer">
          valve-tech/evm-toolkit
        </a>
        .
      </footer>
      </div>
    </>
  )
}

// ---- theme ----
// Initial theme is resolved before first paint in index.html (saved choice →
// OS preference). This hook keeps React in sync: it tracks the live OS
// preference, applies an explicit override when the footer toggle is used, and
// persists that override so it wins on the next visit.
type Theme = 'light' | 'dark'
const THEME_KEY = 'unchained-tx-history.theme'

const systemTheme = (): Theme =>
  window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'

const readSavedTheme = (): Theme | null => {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

const useTheme = (): { theme: Theme; toggleTheme: () => void } => {
  const [override, setOverride] = useState<Theme | null>(readSavedTheme)
  const [sys, setSys] = useState<Theme>(systemTheme)

  // Follow live OS changes until the user makes an explicit choice.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (): void => setSys(mq.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme = override ?? sys
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggleTheme = (): void => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setOverride(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* private mode / quota — stays in-memory for the session */
    }
  }

  return { theme, toggleTheme }
}

// Graffiti faces for the one-time headline "spray" flourish — the accent word
// reels through these on load. NB: Monoton is intentionally absent (it's the
// foreground headline face), so the front/back distinction holds.
const GFONTS = [
  '"Permanent Marker", cursive',
  '"Bangers", cursive',
  '"Bungee", cursive',
  '"Kaushan Script", cursive',
  '"Rock Salt", cursive',
  '"Yellowtail", cursive',
  '"Marck Script", cursive',
  '"Caveat Brush", cursive',
  '"Sigmar One", cursive',
]

/**
 * The graffiti alley background: a flat sky/asphalt backdrop and a circular
 * focal fog (cheap CSS layers), with the receding, tag-covered side walls drawn
 * on a canvas — see {@link CorridorBackground}. aria-hidden, pointer-events:none.
 */
const GraffitiBackground = () => (
  <div className="graffiti-bg" aria-hidden="true">
    {/* flat backdrop: sky over asphalt, meeting at the horizon (= vanishing point) */}
    <div className="backdrop">
      <div className="sky" />
      <div className="ground" />
    </div>
    {/* the corridor walls (bricks + tags), perspective-projected on a canvas */}
    <CorridorBackground />
    {/* circular focal fog where the corridor collapses into its point */}
    <div className="vanish" />
  </div>
)

/** The compound half of the Search button: a caret that flips the load order. */
const OrderMenu = ({ order, onChange }: { order: SortOrder; onChange: (o: SortOrder) => void }) => {
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
    <div className="chain-menu order-menu" ref={ref}>
      <button
        type="button"
        className="go-caret"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Load order: ${order === 'newest' ? 'newest first' : 'oldest first'}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <ul className="chain-list order-list" role="listbox">
          {(['newest', 'oldest'] as SortOrder[]).map((o) => (
            <li key={o} role="option" aria-selected={order === o}>
              <button
                type="button"
                className="chain-option"
                onClick={() => {
                  onChange(o)
                  setOpen(false)
                }}
              >
                {o === 'newest' ? 'Newest first' : 'Oldest first'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Appearance-source picker for the search row: valve's chifra daemon (default),
 * any custom chifra daemon, or the trustless (no-daemon) in-browser scan.
 */
const ChifraMenu = ({ value, onChange }: { value: string; onChange: (url: string) => void }) => {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const hostOf = (u: string): string => {
    try {
      return new URL(u).host
    } catch {
      return u
    }
  }
  const label = value === '' ? 'trustless' : hostOf(value)

  const submitUrl = (): void => {
    const u = url.trim().replace(/\/+$/, '')
    if (!u) return
    onChange(u)
    setAdding(false)
    setUrl('')
    setOpen(false)
  }

  return (
    <div className="chain-menu chifra-menu" ref={ref}>
      <button
        type="button"
        className="chain-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Appearance source — a chifra daemon, or the trustless browser scan"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="chifra-tag">src</span>
        <span className="chifra-host">{label}</span>
        <span className="chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <ul className="chain-list" role="listbox">
          <li role="option" aria-selected={value === CHIFRA_URL}>
            <button
              type="button"
              className="chain-option chifra-opt"
              onClick={() => {
                onChange(CHIFRA_URL)
                setOpen(false)
              }}
            >
              <span className="chifra-opt-name">valve</span>
              <span className="chifra-sub">{hostOf(CHIFRA_URL)}</span>
            </button>
          </li>
          <li role="option" aria-selected={value === ''}>
            <button
              type="button"
              className="chain-option chifra-opt"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              <span className="chifra-opt-name">trustless</span>
              <span className="chifra-sub">no daemon — in-browser</span>
            </button>
          </li>
          <li className="chain-add">
            {adding ? (
              <div className="chain-add-form">
                <input
                  className="chain-add-input"
                  placeholder="https://your-chifra…"
                  value={url}
                  spellCheck={false}
                  autoFocus
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitUrl()
                  }}
                />
                <button type="button" className="chain-add-go" onClick={submitUrl}>
                  Use
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="chain-option chain-add-btn"
                onClick={() => setAdding(true)}
              >
                + Custom daemon
              </button>
            )}
          </li>
        </ul>
      )}
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
