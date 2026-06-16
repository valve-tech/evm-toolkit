# gas-dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `examples/gas-dashboard` — a fully static Vite + React + TS web app that demonstrates the chain-observation half of the toolkit (`@valve-tech/chain-source` + `@valve-tech/gas-oracle`) by watching gas behave per block over public RPC, with capability-aware graceful degradation and zero wallet.

**Architecture:** A single `ChainSource` (over a viem `PublicClient`) feeds a single `gasOracle`; selecting/switching a chain tears the pair down and rebuilds against the new RPC. The oracle's `subscribe(state => …)` callback drives all repaints — its `GasOracleState` already carries `baseFeeHistory` (sparkline), `mempoolSamples` (histogram), `ring` (block-position distribution) and `tiers` (hero row), so the React layer reads a single state object per block. The app probes `source.capabilities()` after `source.ready()` and disables/relabels panels accordingly (no mempool → histogram falls back to a notice + block-included tips; no WS → poll badge). Charts are hand-rolled SVG, no charting library.

**Tech Stack:** Vite 5 + React 18 + TypeScript (strict), `viem ^2`, workspace siblings `@valve-tech/chain-source` and `@valve-tech/gas-oracle` at `^0.18.0`. Vitest for pure-logic unit tests; `tsc -p tsconfig.json && vite build` is the CI gate. Mirrors `examples/unchained-tx-history` for build/config/test conventions and the chain-selector + custom-RPC + chainId-detection pattern.

---

## File Structure

Every file to create lives under `examples/gas-dashboard/`. One responsibility each.

| File | Responsibility |
|---|---|
| `package.json` | Workspace `@valve-tech/example-gas-dashboard`, `"private": true`, sibling deps at `^0.18.0`, example-only `viem`/`react`/`react-dom`, standard `dev`/`build`/`preview`/`typecheck`/`lint`/`test` scripts. |
| `tsconfig.json` | Strict TS, `jsx: react-jsx`, Bundler resolution — copied verbatim from the sibling. |
| `vite.config.ts` | React plugin, `base: './'`, static `dist/` output. |
| `index.html` | Single `#root` mount + module script; instrument-cluster `<title>`/meta. |
| `src/vite-env.d.ts` | `vite/client` types reference. |
| `src/main.tsx` | React root render of `<App/>` + CSS import. |
| `src/styles.css` | Minimal instrument-cluster styling (dark monitor base, grid, badges, tier cards). Hand-written, not theming-pass quality (that is a separate task). |
| `src/config.ts` | `ChainConfig` type + built-in `CHAINS` (PulseChain 369, PulseChain Testnet 943, Ethereum 1) — RPC-only fields (no chifra/index keys). Default chain = CHAINS[0]. |
| `src/lib/chains.ts` | Custom-RPC support: `detectChain(rpcUrl)` (eth_chainId over fetch), viem chain-registry name/symbol resolution, `loadCustomChains`/`saveCustomChains` via localStorage. |
| `src/lib/rpc.ts` | `buildClient(chain)` → a viem `PublicClient` (WS transport when the RPC URL is `ws(s)://`, else `http`). Thin, no business logic. |
| `src/lib/format.ts` | Pure fee/number formatting: `formatGwei`, `formatWei`, `trendArrow`. **Unit-tested.** |
| `src/lib/histogram.ts` | Pure histogram bucketing of `TipSample[]` into `HistogramBucket[]` with tier-cutoff annotations. **Unit-tested.** |
| `src/lib/position.ts` | Pure wrapper around gas-oracle's `tipForBlockPosition` that turns a user-typed gwei tip into a percentile/rank estimate against a sample distribution. **Unit-tested.** |
| `src/lib/capabilities.ts` | Pure capability→panel-enabled decisions: `derivePanelState(caps)` → `{ mempoolEnabled, blockPositionMode, transport, badges }`. **Unit-tested.** |
| `src/lib/dashboard.ts` | The teardown/rebuild orchestrator: `createDashboard(chain, handlers)` builds client → ChainSource → gasOracle, wires `subscribe`, returns `{ dispose }`. Live glue, not unit-tested. |
| `src/components/Sparkline.tsx` | Hand-rolled SVG base-fee sparkline. Not unit-tested. |
| `src/components/Histogram.tsx` | Hand-rolled SVG mempool tip histogram with tier cutoffs overlaid. Not unit-tested. |
| `src/components/TiersRow.tsx` | Four tier cards (slow/standard/fast/instant). Not unit-tested. |
| `src/components/PositionEstimator.tsx` | Tip-input → percentile readout panel. Not unit-tested. |
| `src/components/CapabilityPanel.tsx` | Capability probe + reducer-internals teaching panel. Not unit-tested. |
| `src/components/Banner.tsx` | RPC/connection error banner (tx-history shape). Not unit-tested. |
| `src/App.tsx` | Header (chain switcher, custom-RPC entry, live block number, capability badges) + tiers hero row + 2×2 grid. Owns the dashboard lifecycle + error state. Not unit-tested. |
| `README.md` | What it demonstrates, package wiring, how to run, capability-degradation behavior, no-wallet note. |

Test files (colocated, vitest auto-discovers `*.test.ts`):

| Test file | Covers |
|---|---|
| `src/lib/format.test.ts` | `formatGwei`, `formatWei`, `trendArrow`. |
| `src/lib/histogram.test.ts` | `bucketTips` bucketing + tier-cutoff placement. |
| `src/lib/position.test.ts` | `estimatePosition` wrapper over `tipForBlockPosition`. |
| `src/lib/capabilities.test.ts` | `derivePanelState` for every capability combination. |

---

## Tasks

### Task 1 — Scaffold the workspace (build skeleton, no app logic yet)

**Files:**
- Create: `examples/gas-dashboard/package.json`
- Create: `examples/gas-dashboard/tsconfig.json`
- Create: `examples/gas-dashboard/vite.config.ts`
- Create: `examples/gas-dashboard/index.html`
- Create: `examples/gas-dashboard/src/vite-env.d.ts`
- Create: `examples/gas-dashboard/src/main.tsx`
- Create: `examples/gas-dashboard/src/styles.css`
- Create: `examples/gas-dashboard/src/App.tsx` (placeholder)

**Steps:**

- [ ] Create `examples/gas-dashboard/package.json` (sibling deps at the synced `^0.18.0` line; both packages are currently 0.18.0 — verify with `node -p "require('./packages/gas-oracle/package.json').version"` and match it):
  ```json
  {
    "name": "@valve-tech/example-gas-dashboard",
    "version": "0.18.0",
    "private": true,
    "description": "Static web app: pick an EVM chain (or paste an RPC), watch gas behave per block. A single @valve-tech/chain-source feeds a single @valve-tech/gas-oracle; tiers, a base-fee sparkline, a live mempool tip histogram, and a block-position estimator repaint every block. Capability-aware: degrades gracefully when the RPC lacks a mempool or WS. No wallet — public RPC only.",
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "tsc -p tsconfig.json && vite build",
      "preview": "vite preview",
      "typecheck": "tsc -p tsconfig.json --noEmit",
      "lint": "eslint src",
      "test": "vitest run"
    },
    "dependencies": {
      "@valve-tech/chain-source": "^0.18.0",
      "@valve-tech/gas-oracle": "^0.18.0",
      "react": "^18.3.1",
      "react-dom": "^18.3.1",
      "viem": "^2.21.0"
    },
    "devDependencies": {
      "@types/react": "^18.3.0",
      "@types/react-dom": "^18.3.0",
      "@vitejs/plugin-react": "^4.3.0",
      "vite": "^5.4.0"
    }
  }
  ```
  (`vitest`, `eslint`, `typescript` come from the root workspace devDeps — do NOT add them here; the sibling example doesn't either.)
- [ ] Create `examples/gas-dashboard/tsconfig.json` verbatim from the sibling:
  ```json
  {
    "compilerOptions": {
      "target": "ES2020",
      "useDefineForClassFields": true,
      "lib": ["ES2020", "DOM", "DOM.Iterable"],
      "module": "ESNext",
      "skipLibCheck": true,
      "moduleResolution": "Bundler",
      "allowImportingTsExtensions": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "noEmit": true,
      "jsx": "react-jsx",
      "strict": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true,
      "noFallthroughCasesInSwitch": true
    },
    "include": ["src", "vite.config.ts"]
  }
  ```
- [ ] Create `examples/gas-dashboard/vite.config.ts`:
  ```ts
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'

  // Fully static output — no server code, no env secrets. Deploy = copy dist/.
  export default defineConfig({
    plugins: [react()],
    base: './',
    build: { outDir: 'dist', target: 'es2020' },
  })
  ```
- [ ] Create `examples/gas-dashboard/index.html`:
  ```html
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Gas monitor — watch an EVM chain's fee market, per block</title>
      <meta
        name="description"
        content="Pick an EVM chain or paste an RPC and watch gas behave per block: live tiers, a base-fee sparkline, a mempool tip histogram, and a block-position estimator. Degrades gracefully on RPCs without a mempool or WebSocket. No wallet — read-only."
      />
      <meta name="theme-color" content="#07090c" />
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="/src/main.tsx"></script>
    </body>
  </html>
  ```
- [ ] Create `examples/gas-dashboard/src/vite-env.d.ts`:
  ```ts
  /// <reference types="vite/client" />
  ```
- [ ] Create `examples/gas-dashboard/src/main.tsx`:
  ```tsx
  import React from 'react'
  import ReactDOM from 'react-dom/client'

  import { App } from './App'
  import './styles.css'

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
  ```
- [ ] Create `examples/gas-dashboard/src/styles.css` with a minimal instrument-cluster base (dark monitor background, header bar, a `.grid-2x2` CSS grid, `.tier-card`, `.badge`, `.badge.off`, `.banner.error`, `.panel`, `.muted`). Keep it lean — the full theming pass is a separate task. Example skeleton:
  ```css
  :root { color-scheme: dark; --bg:#07090c; --panel:#0f141b; --line:#1d2630; --ink:#d7e2ec; --muted:#7e8a98; --ok:#3fd1a3; --warn:#e0a44b; --off:#46525f; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
  header { display:flex; gap:1rem; align-items:center; flex-wrap:wrap; padding:1rem; border-bottom:1px solid var(--line); }
  .badge { padding:.15rem .5rem; border:1px solid var(--line); border-radius:.4rem; color:var(--ok); }
  .badge.off { color:var(--off); }
  .grid-2x2 { display:grid; grid-template-columns:1fr 1fr; gap:1rem; padding:1rem; }
  .tiers { display:grid; grid-template-columns:repeat(4,1fr); gap:1rem; padding:1rem; }
  .tier-card, .panel { background:var(--panel); border:1px solid var(--line); border-radius:.6rem; padding:1rem; }
  .banner.error { background:#2a1416; border:1px solid #6b2630; color:#f3b6bd; padding:.75rem 1rem; margin:1rem; border-radius:.5rem; }
  .muted { color:var(--muted); }
  input, select, button { background:var(--panel); color:var(--ink); border:1px solid var(--line); border-radius:.4rem; padding:.4rem .6rem; font:inherit; }
  ```
- [ ] Create `examples/gas-dashboard/src/App.tsx` placeholder so the build resolves:
  ```tsx
  export const App = (): JSX.Element => <div>gas-dashboard</div>
  ```
- [ ] Install the new workspace from the repo root: `yarn install` (registers the workspace; expect it to resolve sibling `^0.18.0` to the local packages).
- [ ] Verify the skeleton builds: `yarn workspace @valve-tech/example-gas-dashboard build` — expect PASS (tsc clean + a `dist/` is emitted).
- [ ] Commit: `git add examples/gas-dashboard && git commit -m "feat(examples): gas-dashboard — scaffold workspace + static build skeleton"`

---

### Task 2 — `config.ts` + `chains.ts` (chain selector, custom RPC, chainId detection)

**Files:**
- Create: `examples/gas-dashboard/src/config.ts`
- Create: `examples/gas-dashboard/src/lib/chains.ts`

**Steps:**

- [ ] Create `examples/gas-dashboard/src/config.ts` — RPC-only `ChainConfig` (drop tx-history's chifra/index keys), built-in chains, default = CHAINS[0]:
  ```ts
  /**
   * Build-time configuration. Everything here is PUBLIC — a static site holds
   * no secrets. RPC-only: this example never indexes, so there are no chifra /
   * Unchained keys here (unlike unchained-tx-history). Swap rpcUrl for your own
   * node, or paste one at runtime (see src/lib/chains.ts).
   */
  export interface ChainConfig {
    chainId: number
    label: string
    /** JSON-RPC endpoint. ws:// or wss:// builds a WS transport (subscribeBlocks push); http(s) polls. */
    rpcUrl: string
    /** Native-currency symbol — currently informational; fees print in gwei. */
    symbol: string
    /** Block-explorer base (no trailing slash), for future links. */
    explorerUrl: string
  }

  // PulseChain (369) leads — the default chain (CHAINS[0]).
  export const CHAINS: ChainConfig[] = [
    {
      chainId: 369,
      label: 'PulseChain',
      rpcUrl: 'https://rpc.pulsechain.com',
      symbol: 'PLS',
      explorerUrl: 'https://explore.valve.city',
    },
    {
      chainId: 943,
      label: 'PulseChain Testnet v4',
      rpcUrl: 'https://rpc.v4.testnet.pulsechain.com',
      symbol: 'tPLS',
      explorerUrl: 'https://explore.valve.city',
    },
    {
      chainId: 1,
      label: 'Ethereum',
      rpcUrl: 'https://rpc-ethereum.g4mm4.io',
      symbol: 'ETH',
      explorerUrl: 'https://etherscan.io',
    },
  ]
  ```
- [ ] Create `examples/gas-dashboard/src/lib/chains.ts` — mirror the sibling's `detectChain` + localStorage helpers, adapted to the slimmer `ChainConfig`:
  ```ts
  /**
   * Custom-RPC support: paste any EVM RPC, detect its chain id over the wire,
   * fill in name/symbol from viem's chain registry. If the detected id matches
   * a built-in chain, inherit its label/symbol/explorer. Custom chains persist
   * in localStorage.
   */
  import { CHAINS, type ChainConfig } from '../config'

  interface ViemChainLite {
    id: number
    name: string
    nativeCurrency: { symbol: string }
    blockExplorers?: { default: { url: string } }
  }

  // viem/chains is large — load it lazily so it splits into its own chunk.
  let viemChainsCache: ViemChainLite[] | null = null
  const viemChainFor = async (id: number): Promise<ViemChainLite | undefined> => {
    if (!viemChainsCache) {
      const mod = await import('viem/chains')
      viemChainsCache = (Object.values(mod) as unknown[]).filter(
        (c): c is ViemChainLite =>
          typeof c === 'object' &&
          c !== null &&
          typeof (c as { id?: unknown }).id === 'number' &&
          typeof (c as { name?: unknown }).name === 'string',
      )
    }
    return viemChainsCache.find((c) => c.id === id)
  }

  const LS_KEY = 'gas-dashboard.custom-chains'

  export const loadCustomChains = (): ChainConfig[] => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      return raw ? (JSON.parse(raw) as ChainConfig[]) : []
    } catch {
      return []
    }
  }

  export const saveCustomChains = (chains: ChainConfig[]): void => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(chains))
    } catch {
      /* private mode / quota — non-fatal */
    }
  }

  /** Ask an RPC for its chain id, then build a ChainConfig around it. */
  export const detectChain = async (rpcUrl: string): Promise<ChainConfig> => {
    const url = rpcUrl.trim()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    })
    if (!res.ok) throw new Error(`RPC responded ${res.status}`)
    const json = (await res.json()) as { result?: string; error?: { message: string } }
    if (json.error) throw new Error(json.error.message)
    if (!json.result) throw new Error('RPC did not return a chain id')

    const chainId = Number(BigInt(json.result))
    const known = CHAINS.find((c) => c.chainId === chainId)
    const vc = await viemChainFor(chainId)

    return {
      chainId,
      label: known?.label ?? vc?.name ?? `Chain ${chainId}`,
      rpcUrl: url,
      symbol: known?.symbol ?? vc?.nativeCurrency.symbol ?? 'ETH',
      explorerUrl: known?.explorerUrl ?? vc?.blockExplorers?.default.url ?? '',
    }
  }
  ```
  Note: `detectChain` over `ws://` URLs won't accept a `fetch` POST — guard for that. Add at the top of `detectChain`, before the fetch:
  ```ts
    if (/^wss?:\/\//i.test(url)) {
      throw new Error('Paste an http(s) RPC to detect the chain; switch to ws:// only after selecting it.')
    }
  ```
- [ ] Verify it still builds: `yarn workspace @valve-tech/example-gas-dashboard build` — expect PASS.
- [ ] Commit: `git add examples/gas-dashboard/src && git commit -m "feat(examples): gas-dashboard — chain config + custom-RPC chainId detection"`

---

### Task 3 — `format.ts` (pure fee formatting) — TDD

**Files:**
- Create: `examples/gas-dashboard/src/lib/format.test.ts`
- Create: `examples/gas-dashboard/src/lib/format.ts`

**Steps:**

- [ ] Write the failing test `examples/gas-dashboard/src/lib/format.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { formatGwei, formatWei, trendArrow } from './format'

  describe('formatGwei', () => {
    it('renders wei as a trimmed gwei string', () => {
      expect(formatGwei(0n)).toBe('0')
      expect(formatGwei(1_000_000_000n)).toBe('1')
      expect(formatGwei(1_500_000_000n)).toBe('1.5')
      expect(formatGwei(1_234_567_890n)).toBe('1.23457') // 6 sig frac digits, trimmed
    })
    it('handles sub-gwei tips without dropping to 0', () => {
      expect(formatGwei(123_456_789n)).toBe('0.123457')
    })
  })

  describe('formatWei', () => {
    it('passes integers through with thousands separators', () => {
      expect(formatWei(0n)).toBe('0')
      expect(formatWei(1_500_000_000n)).toBe('1,500,000,000')
    })
  })

  describe('trendArrow', () => {
    it('maps the gas-oracle Trend union to a glyph', () => {
      expect(trendArrow('rising')).toBe('▲')
      expect(trendArrow('falling')).toBe('▼')
      expect(trendArrow('stable')).toBe('▬')
    })
  })
  ```
- [ ] Run: `yarn workspace @valve-tech/example-gas-dashboard test` — expect FAIL (module `./format` not found).
- [ ] Create `examples/gas-dashboard/src/lib/format.ts` (complete implementation):
  ```ts
  /** Display helpers — all pure. Fees print in gwei; raw counts get separators. */

  import type { Trend } from '@valve-tech/gas-oracle'

  const GWEI = 1_000_000_000n

  /** Format a wei value as a trimmed gwei decimal string (max 6 frac digits). */
  export const formatGwei = (wei: bigint): string => {
    if (wei === 0n) return '0'
    const whole = wei / GWEI
    const frac = wei % GWEI
    if (frac === 0n) return whole.toString()
    const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '').slice(0, 6)
    return fracStr === '' ? whole.toString() : `${whole.toString()}.${fracStr}`
  }

  /** Format a bigint with thousands separators (for raw wei / counts). */
  export const formatWei = (n: bigint): string =>
    n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  /** Map a gas-oracle `Trend` to a single-glyph indicator. */
  export const trendArrow = (t: Trend): string =>
    t === 'rising' ? '▲' : t === 'falling' ? '▼' : '▬'
  ```
- [ ] Run: `yarn workspace @valve-tech/example-gas-dashboard test` — expect PASS.
- [ ] Commit: `git add examples/gas-dashboard/src/lib/format.* && git commit -m "feat(examples): gas-dashboard — pure gwei/wei/trend formatting (tested)"`

---

### Task 4 — `histogram.ts` (pure tip bucketing with tier cutoffs) — TDD

**Files:**
- Create: `examples/gas-dashboard/src/lib/histogram.test.ts`
- Create: `examples/gas-dashboard/src/lib/histogram.ts`

The histogram panel buckets `TipSample[]` (from `state.mempoolSamples`) into `n` evenly-spaced tip buckets between min and max tip, returning per-bucket counts + gas weight, plus the tier-cutoff tip values mapped onto bucket indices so the chart can overlay the four tier lines.

**Steps:**

- [ ] Write the failing test `examples/gas-dashboard/src/lib/histogram.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import type { TipSample } from '@valve-tech/gas-oracle'
  import { bucketTips } from './histogram'

  const s = (tip: bigint, gas = 21_000n): TipSample => ({ tip, gas })

  describe('bucketTips', () => {
    it('returns an empty result for no samples', () => {
      const r = bucketTips([], 4, {})
      expect(r.buckets).toEqual([])
      expect(r.maxCount).toBe(0)
    })

    it('buckets samples into evenly-spaced tip ranges across [min,max]', () => {
      // tips 0,1,2,3 gwei into 4 buckets → one each
      const samples = [s(0n), s(1_000_000_000n), s(2_000_000_000n), s(3_000_000_000n)]
      const r = bucketTips(samples, 4, {})
      expect(r.buckets).toHaveLength(4)
      expect(r.buckets.map((b) => b.count)).toEqual([1, 1, 1, 1])
      expect(r.maxCount).toBe(1)
      // first bucket starts at min, last bucket ends at max
      expect(r.buckets[0].loTip).toBe(0n)
      expect(r.buckets[3].hiTip).toBe(3_000_000_000n)
    })

    it('collapses a single distinct tip into one fully-loaded bucket', () => {
      const r = bucketTips([s(5n), s(5n), s(5n)], 4, {})
      expect(r.buckets.reduce((n, b) => n + b.count, 0)).toBe(3)
      expect(r.maxCount).toBe(3)
    })

    it('maps tier cutoffs to bucket indices (the overlay positions)', () => {
      const samples = [s(0n), s(1_000_000_000n), s(2_000_000_000n), s(3_000_000_000n)]
      const r = bucketTips(samples, 4, {
        slow: 0n,
        standard: 1_000_000_000n,
        fast: 2_000_000_000n,
        instant: 3_000_000_000n,
      })
      // each cutoff lands in the bucket whose [lo,hi) range contains it
      expect(r.cutoffs.map((c) => c.bucketIndex)).toEqual([0, 1, 2, 3])
      expect(r.cutoffs.map((c) => c.tier)).toEqual(['slow', 'standard', 'fast', 'instant'])
    })
  })
  ```
- [ ] Run: `yarn workspace @valve-tech/example-gas-dashboard test` — expect FAIL (`./histogram` not found).
- [ ] Create `examples/gas-dashboard/src/lib/histogram.ts` (complete implementation):
  ```ts
  /**
   * Pure histogram bucketing for the mempool tip panel. Buckets a
   * `TipSample[]` (typically `state.mempoolSamples`) into `n` evenly-spaced
   * tip ranges across [minTip, maxTip], and maps the four tier cutoffs onto
   * bucket indices so the SVG can draw overlay lines. No I/O, no oracle.
   */
  import type { TipSample } from '@valve-tech/gas-oracle'
  import { TIER_LADDER, type TierName } from '@valve-tech/gas-oracle'

  export interface HistogramBucket {
    loTip: bigint
    hiTip: bigint
    count: number
    /** Sum of sample gas in this bucket — the gas-weighted height. */
    gas: bigint
  }

  export interface CutoffMark {
    tier: TierName
    tip: bigint
    /** Which bucket this cutoff falls into; clamped to [0, n-1]. */
    bucketIndex: number
  }

  export interface HistogramResult {
    buckets: HistogramBucket[]
    cutoffs: CutoffMark[]
    maxCount: number
    maxGas: bigint
  }

  /** Tier-cutoff tip values (maxPriorityFeePerGas per tier). Optional/partial. */
  export type TierCutoffs = Partial<Record<TierName, bigint>>

  export const bucketTips = (
    samples: TipSample[],
    n: number,
    cutoffs: TierCutoffs,
  ): HistogramResult => {
    if (samples.length === 0 || n <= 0) {
      return { buckets: [], cutoffs: [], maxCount: 0, maxGas: 0n }
    }

    let min = samples[0].tip
    let max = samples[0].tip
    for (const s of samples) {
      if (s.tip < min) min = s.tip
      if (s.tip > max) max = s.tip
    }

    const span = max - min
    const nBig = BigInt(n)
    // Bucket index for a tip: floor((tip-min)/span * n), clamped to [0,n-1].
    const indexFor = (tip: bigint): number => {
      if (span === 0n) return 0
      const idx = Number(((tip - min) * nBig) / span)
      return idx >= n ? n - 1 : idx < 0 ? 0 : idx
    }

    const buckets: HistogramBucket[] = []
    for (let i = 0; i < n; i += 1) {
      const lo = span === 0n ? min : min + (span * BigInt(i)) / nBig
      const hi = span === 0n ? max : min + (span * BigInt(i + 1)) / nBig
      buckets.push({ loTip: lo, hiTip: hi, count: 0, gas: 0n })
    }

    let maxCount = 0
    let maxGas = 0n
    for (const s of samples) {
      const b = buckets[indexFor(s.tip)]
      b.count += 1
      b.gas += s.gas
      if (b.count > maxCount) maxCount = b.count
      if (b.gas > maxGas) maxGas = b.gas
    }

    const marks: CutoffMark[] = []
    for (const tier of TIER_LADDER) {
      const tip = cutoffs[tier]
      if (tip === undefined) continue
      marks.push({ tier, tip, bucketIndex: indexFor(tip) })
    }

    return { buckets, cutoffs: marks, maxCount, maxGas }
  }
  ```
- [ ] Run: `yarn workspace @valve-tech/example-gas-dashboard test` — expect PASS.
- [ ] Commit: `git add examples/gas-dashboard/src/lib/histogram.* && git commit -m "feat(examples): gas-dashboard — pure mempool tip bucketing + tier overlay (tested)"`

---

### Task 5 — `position.ts` (block-position percentile wrapper) — TDD

**Files:**
- Create: `examples/gas-dashboard/src/lib/position.test.ts`
- Create: `examples/gas-dashboard/src/lib/position.ts`

This wraps gas-oracle's exported `tipForBlockPosition(samples, query)` (real signature: `samples: TipSample[]`, `query` a discriminated union where `rank`/`percentile` are **bigint**; result has `requiredTip`, `pivot`, `rank: bigint`, `gasFromTop: bigint`). Our wrapper goes the *other* direction — given a user-typed tip, estimate where it lands — by walking the sorted distribution. We keep `tipForBlockPosition` available for a "tip for top-N" readout, and add `estimatePosition(samples, tip)` returning `{ rank, total, percentile, gasAhead }` for the "where does MY tip land" answer.

**Steps:**

- [ ] Write the failing test `examples/gas-dashboard/src/lib/position.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import type { TipSample } from '@valve-tech/gas-oracle'
  import { estimatePosition, tipForRank } from './position'

  const s = (tip: bigint, gas = 21_000n): TipSample => ({ tip, gas })

  describe('estimatePosition', () => {
    it('reports empty distribution', () => {
      const r = estimatePosition([], 5n)
      expect(r).toEqual({ rank: 0, total: 0, percentile: 0, gasAhead: 0n })
    })

    it('ranks a tip by how many samples it would outrank (tip-desc)', () => {
      // distribution tips: 10,8,6,4,2 ; my tip 7 outranks 6,4,2 → rank 2 from top
      const samples = [s(10n), s(8n), s(6n), s(4n), s(2n)]
      const r = estimatePosition(samples, 7n)
      expect(r.total).toBe(5)
      expect(r.rank).toBe(2) // two samples (10,8) are ahead
      // gas ahead = gas of the 2 samples that outrank me
      expect(r.gasAhead).toBe(42_000n)
      // percentile: fraction of the field at or below my tip → here 3/5 = 60
      expect(r.percentile).toBe(60)
    })

    it('a top tip lands at rank 0 with 100th percentile', () => {
      const samples = [s(5n), s(4n), s(3n)]
      const r = estimatePosition(samples, 9n)
      expect(r.rank).toBe(0)
      expect(r.percentile).toBe(100)
    })
  })

  describe('tipForRank', () => {
    it('delegates to gas-oracle tipForBlockPosition (rank query, bigint rank)', () => {
      const samples = [s(10n), s(8n), s(6n), s(4n), s(2n)]
      const out = tipForRank(samples, 2n)
      // landing in the top 2 means beating the #2 sample (tip 8) → 8 + 1
      expect(out.requiredTip).toBe(9n)
    })
  })
  ```
- [ ] Run: `yarn workspace @valve-tech/example-gas-dashboard test` — expect FAIL (`./position` not found).

  > Tip for the implementer: confirm the exact `tipForBlockPosition` contract before finalizing the `tipForRank` assertion — `requiredTip` is documented as `pivot.tip + 1n` for `rank` queries. The pivot for `{ kind: 'rank', rank: 2n }` is the sample at the rank-2 boundary. If the package's boundary indexing differs from the expectation above, adjust the expected `9n` to the value the real function returns (run the test to see the actual), then lock it in — do NOT change the wrapper to force a number.

- [ ] Create `examples/gas-dashboard/src/lib/position.ts` (complete implementation):
  ```ts
  /**
   * Block-position helpers for the estimator panel.
   *
   * `estimatePosition` answers "where does MY tip land" — given a user tip and
   * a sample distribution, returns rank-from-top, the field size, a percentile,
   * and the gas ahead of you. Pure; the inverse of gas-oracle's
   * `tipForBlockPosition` (which answers "what tip do I need for position X").
   *
   * `tipForRank` re-exposes the package helper for the "tip to land in top N"
   * readout, so the panel can show both directions from the same data.
   */
  import { tipForBlockPosition, type BlockPositionResult } from '@valve-tech/gas-oracle'
  import type { TipSample } from '@valve-tech/gas-oracle'

  export interface PositionEstimate {
    /** 0-indexed rank from the top — how many samples outrank your tip. */
    rank: number
    /** Total samples in the distribution. */
    total: number
    /** Percentile of the field at or below your tip (0–100, integer). */
    percentile: number
    /** Sum of gas for the samples that outrank you. */
    gasAhead: bigint
  }

  export const estimatePosition = (samples: TipSample[], tip: bigint): PositionEstimate => {
    const total = samples.length
    if (total === 0) return { rank: 0, total: 0, percentile: 0, gasAhead: 0n }

    let ahead = 0
    let gasAhead = 0n
    let atOrBelow = 0
    for (const s of samples) {
      if (s.tip > tip) {
        ahead += 1
        gasAhead += s.gas
      } else {
        atOrBelow += 1
      }
    }
    const percentile = Math.round((atOrBelow / total) * 100)
    return { rank: ahead, total, percentile, gasAhead }
  }

  /** "What tip do I need to land in the top `rank`?" — delegates to the oracle. */
  export const tipForRank = (samples: TipSample[], rank: bigint): BlockPositionResult =>
    tipForBlockPosition(samples, { kind: 'rank', rank })
  ```
- [ ] Run: `yarn workspace @valve-tech/example-gas-dashboard test` — expect PASS (after locking the `tipForRank` expectation to the real value per the note above).
- [ ] Commit: `git add examples/gas-dashboard/src/lib/position.* && git commit -m "feat(examples): gas-dashboard — block-position estimate wrapper (tested)"`

---

### Task 6 — `capabilities.ts` (capability → panel-enabled decisions) — TDD

**Files:**
- Create: `examples/gas-dashboard/src/lib/capabilities.test.ts`
- Create: `examples/gas-dashboard/src/lib/capabilities.ts`

Pure mapping from chain-source's `Capabilities` to per-panel decisions. `Capabilities` shape (from chain-source AGENTS.md): `newHeads: 'subscription' | 'poll-only' | 'unavailable'`, `newPendingTransactions: …`, `txpoolContent: 'available' | 'gated'`, `receiptByHash: 'available' | 'unavailable'`, `reprobeOnReconnect: boolean`.

**Steps:**

- [ ] Write the failing test `examples/gas-dashboard/src/lib/capabilities.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import type { Capabilities } from '@valve-tech/chain-source'
  import { derivePanelState } from './capabilities'

  const caps = (over: Partial<Capabilities> = {}): Capabilities => ({
    newHeads: 'poll-only',
    newPendingTransactions: 'poll-only',
    txpoolContent: 'gated',
    receiptByHash: 'available',
    reprobeOnReconnect: false,
    ...over,
  })

  describe('derivePanelState', () => {
    it('gated txpool → histogram disabled, estimator falls back to block tips', () => {
      const p = derivePanelState(caps({ txpoolContent: 'gated' }))
      expect(p.mempoolEnabled).toBe(false)
      expect(p.blockPositionMode).toBe('block-included')
      expect(p.badges.find((b) => b.id === 'mempool')?.on).toBe(false)
    })

    it('available txpool → histogram enabled, estimator uses mempool+ring', () => {
      const p = derivePanelState(caps({ txpoolContent: 'available' }))
      expect(p.mempoolEnabled).toBe(true)
      expect(p.blockPositionMode).toBe('mempool')
      expect(p.badges.find((b) => b.id === 'mempool')?.on).toBe(true)
    })

    it('newHeads subscription → ws transport badge on', () => {
      const p = derivePanelState(caps({ newHeads: 'subscription' }))
      expect(p.transport).toBe('ws')
      expect(p.badges.find((b) => b.id === 'ws')?.on).toBe(true)
      expect(p.badges.find((b) => b.id === 'http')?.on).toBe(true)
    })

    it('newHeads poll-only → http poll transport, ws badge off', () => {
      const p = derivePanelState(caps({ newHeads: 'poll-only' }))
      expect(p.transport).toBe('http-poll')
      expect(p.badges.find((b) => b.id === 'ws')?.on).toBe(false)
    })
  })
  ```
- [ ] Run: `yarn workspace @valve-tech/example-gas-dashboard test` — expect FAIL (`./capabilities` not found).
- [ ] Create `examples/gas-dashboard/src/lib/capabilities.ts` (complete implementation):
  ```ts
  /**
   * Pure capability → panel-enabled decisions. The teaching core of the demo:
   * chain-source probes the RPC, this maps the probe onto what the UI can show.
   * No silent downgrade — every disabled panel gets an explanation string.
   */
  import type { Capabilities } from '@valve-tech/chain-source'

  export type Transport = 'ws' | 'http-poll'
  export type BlockPositionMode = 'mempool' | 'block-included'

  export interface Badge {
    id: 'http' | 'ws' | 'mempool'
    label: string
    on: boolean
    detail: string
  }

  export interface PanelState {
    /** Mempool histogram panel is live (txpool_content available). */
    mempoolEnabled: boolean
    /** Why the histogram is off, for the degradation notice. '' when on. */
    mempoolReason: string
    /** Block-position estimator distribution source. */
    blockPositionMode: BlockPositionMode
    /** How blocks arrive — push subscription vs interval poll. */
    transport: Transport
    badges: Badge[]
  }

  export const derivePanelState = (caps: Capabilities): PanelState => {
    const mempoolEnabled = caps.txpoolContent === 'available'
    const transport: Transport = caps.newHeads === 'subscription' ? 'ws' : 'http-poll'

    return {
      mempoolEnabled,
      mempoolReason: mempoolEnabled
        ? ''
        : "this RPC doesn't expose the mempool (txpool_content is gated)",
      blockPositionMode: mempoolEnabled ? 'mempool' : 'block-included',
      transport,
      badges: [
        {
          id: 'http',
          label: 'HTTP',
          on: true,
          detail: 'JSON-RPC over HTTP — always available',
        },
        {
          id: 'ws',
          label: 'WS',
          on: transport === 'ws',
          detail:
            transport === 'ws'
              ? 'eth_subscribe(newHeads) is live — push updates'
              : 'no working subscription — polling on the interval timer',
        },
        {
          id: 'mempool',
          label: 'mempool',
          on: mempoolEnabled,
          detail: mempoolEnabled
            ? 'txpool_content available — live pending-tx tips'
            : 'txpool_content gated — histogram falls back to recent block tips',
        },
      ],
    }
  }
  ```
- [ ] Run: `yarn workspace @valve-tech/example-gas-dashboard test` — expect PASS.
- [ ] Commit: `git add examples/gas-dashboard/src/lib/capabilities.* && git commit -m "feat(examples): gas-dashboard — capability→panel decisions (tested)"`

---

### Task 7 — `rpc.ts` + `dashboard.ts` (live source/oracle orchestration)

**Files:**
- Create: `examples/gas-dashboard/src/lib/rpc.ts`
- Create: `examples/gas-dashboard/src/lib/dashboard.ts`

No unit tests — this is live-chain glue. Verified via the manual run in Task 11.

**Steps:**

- [ ] Create `examples/gas-dashboard/src/lib/rpc.ts` — build a viem `PublicClient`, WS transport for `ws(s)://`, HTTP otherwise:
  ```ts
  /**
   * Build a viem PublicClient for a ChainConfig. ws:// or wss:// uses a
   * WebSocket transport (so chain-source can probe a real eth_subscribe push
   * path); everything else uses HTTP (chain-source polls on its interval).
   */
  import { createPublicClient, http, webSocket, type PublicClient } from 'viem'
  import type { ChainConfig } from '../config'

  export const buildClient = (chain: ChainConfig): PublicClient => {
    const isWs = /^wss?:\/\//i.test(chain.rpcUrl)
    const transport = isWs ? webSocket(chain.rpcUrl) : http(chain.rpcUrl)
    // Minimal chain stub — chain-source only needs the transport + id; viem's
    // PublicClient is happy with an id/name/native-currency triple.
    return createPublicClient({
      transport,
      chain: {
        id: chain.chainId,
        name: chain.label,
        nativeCurrency: { name: chain.symbol, symbol: chain.symbol, decimals: 18 },
        rpcUrls: { default: { http: isWs ? [] : [chain.rpcUrl] } },
      },
    }) as PublicClient
  }
  ```
- [ ] Create `examples/gas-dashboard/src/lib/dashboard.ts` — the teardown/rebuild orchestrator. ONE ChainSource feeds ONE gas-oracle; `subscribe` drives repaints; `dispose` tears both down:
  ```ts
  /**
   * The single-chain observation pipeline. createDashboard builds:
   *
   *   PublicClient → ChainSource → gasOracle
   *
   * one of each, wired so the oracle's per-block `subscribe` callback delivers a
   * fresh GasOracleState to the UI. Capabilities are probed (source.ready) and
   * reported once up front. Switching chains in App.tsx calls dispose() and
   * builds a new Dashboard — demonstrating one-ChainSource-per-chain cleanly.
   *
   * keepMempoolSnapshot is ON so state.mempoolSamples is populated for the
   * histogram and estimator; on a gated RPC the samples are simply empty and
   * the capability layer routes the UI to the block-included fallback.
   */
  import { createChainSource, type Capabilities } from '@valve-tech/chain-source'
  import { createGasOracle, type GasOracleState } from '@valve-tech/gas-oracle'
  import type { ChainConfig } from '../config'
  import { buildClient } from './rpc'

  export interface DashboardHandlers {
    onState: (state: GasOracleState) => void
    onCapabilities: (caps: Capabilities) => void
    onError: (err: Error) => void
  }

  export interface Dashboard {
    dispose: () => void
  }

  export const createDashboard = (
    chain: ChainConfig,
    handlers: DashboardHandlers,
  ): Dashboard => {
    const client = buildClient(chain)

    const source = createChainSource({
      client,
      onError: (e) => handlers.onError(e instanceof Error ? e : new Error(String(e))),
    })

    const oracle = createGasOracle({
      source,
      chainId: chain.chainId,
      keepMempoolSnapshot: true,
    })

    // Repaint on every published state.
    const unsub = oracle.subscribe((state) => handlers.onState(state))

    source.start()
    oracle.start()

    // Report real capabilities once the eager probe lands, then force one poll
    // so the first paint isn't empty (getState is null until the first cycle).
    void source
      .ready()
      .then(async () => {
        handlers.onCapabilities(source.capabilities())
        await oracle.pollOnce()
      })
      .catch((e) =>
        handlers.onError(e instanceof Error ? e : new Error(String(e))),
      )

    return {
      dispose: () => {
        unsub()
        oracle.stop()
        source.stop()
      },
    }
  }
  ```
  > Implementer check: confirm `createGasOracle` accepts `{ source, chainId }` in this version (the AGENTS.md shows both `{ client, chainId }` and the shared-`source` shape in chain-source's "shared with sibling derived views" example). Grep `packages/gas-oracle/src/oracle.ts` for the `CreateGasOracleOptions` `source`/`client` fields and use whichever the installed version exports. If only `client` is accepted, pass `{ client, chainId, keepMempoolSnapshot: true }` and let the oracle own its own source (the spec's "ONE ChainSource feeds ONE oracle" is still satisfied logically; prefer the shared-`source` form if available so capabilities come from the same probe).
- [ ] Verify build: `yarn workspace @valve-tech/example-gas-dashboard build` — expect PASS.
- [ ] Commit: `git add examples/gas-dashboard/src/lib/rpc.ts examples/gas-dashboard/src/lib/dashboard.ts && git commit -m "feat(examples): gas-dashboard — client builder + source/oracle orchestration"`

---

### Task 8 — SVG chart components (Sparkline, Histogram)

**Files:**
- Create: `examples/gas-dashboard/src/components/Sparkline.tsx`
- Create: `examples/gas-dashboard/src/components/Histogram.tsx`

Hand-rolled SVG, no charting library. Not unit-tested — manual verification in Task 11.

**Steps:**

- [ ] Create `examples/gas-dashboard/src/components/Sparkline.tsx` — base-fee trend from `state.baseFeeHistory` (a `bigint[]`):
  ```tsx
  import { formatGwei } from '../lib/format'

  interface SparklineProps {
    /** Base-fee-per-gas history, oldest → newest (wei). From GasOracleState.baseFeeHistory. */
    history: bigint[]
    width?: number
    height?: number
  }

  export const Sparkline = ({ history, width = 360, height = 96 }: SparklineProps): JSX.Element => {
    if (history.length < 2) {
      return <p className="muted">Collecting base-fee samples…</p>
    }
    let min = history[0]
    let max = history[0]
    for (const v of history) {
      if (v < min) min = v
      if (v > max) max = v
    }
    const span = max - min === 0n ? 1n : max - min
    const stepX = width / (history.length - 1)
    const y = (v: bigint): number =>
      height - Number(((v - min) * BigInt(Math.round(height - 4))) / span) - 2
    const points = history.map((v, i) => `${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

    return (
      <div>
        <svg width={width} height={height} role="img" aria-label="base fee trend">
          <polyline points={points} fill="none" stroke="var(--ok)" strokeWidth={2} />
        </svg>
        <p className="muted">
          base fee {formatGwei(history[history.length - 1])} gwei (min {formatGwei(min)} · max{' '}
          {formatGwei(max)})
        </p>
      </div>
    )
  }
  ```
- [ ] Create `examples/gas-dashboard/src/components/Histogram.tsx` — bars from `bucketTips`, tier cutoffs overlaid:
  ```tsx
  import type { HistogramResult } from '../lib/histogram'
  import { formatGwei } from '../lib/format'

  interface HistogramProps {
    data: HistogramResult
    width?: number
    height?: number
  }

  const TIER_COLOR: Record<string, string> = {
    slow: '#6b7785',
    standard: '#3fd1a3',
    fast: '#e0a44b',
    instant: '#e06a6a',
  }

  export const Histogram = ({ data, width = 360, height = 120 }: HistogramProps): JSX.Element => {
    if (data.buckets.length === 0 || data.maxCount === 0) {
      return <p className="muted">No pending samples to chart.</p>
    }
    const n = data.buckets.length
    const barW = width / n
    return (
      <svg width={width} height={height} role="img" aria-label="mempool tip histogram">
        {data.buckets.map((b, i) => {
          const h = (b.count / data.maxCount) * (height - 4)
          return (
            <rect
              key={i}
              x={i * barW + 1}
              y={height - h}
              width={Math.max(barW - 2, 1)}
              height={h}
              fill="var(--line)"
            />
          )
        })}
        {data.cutoffs.map((c) => {
          const x = (c.bucketIndex + 0.5) * barW
          return (
            <g key={c.tier}>
              <line
                x1={x}
                y1={0}
                x2={x}
                y2={height}
                stroke={TIER_COLOR[c.tier] ?? 'white'}
                strokeWidth={1.5}
                strokeDasharray="3 2"
              >
                <title>
                  {c.tier}: {formatGwei(c.tip)} gwei
                </title>
              </line>
            </g>
          )
        })}
      </svg>
    )
  }
  ```
- [ ] Verify build: `yarn workspace @valve-tech/example-gas-dashboard build` — expect PASS.
- [ ] Commit: `git add examples/gas-dashboard/src/components/Sparkline.tsx examples/gas-dashboard/src/components/Histogram.tsx && git commit -m "feat(examples): gas-dashboard — hand-rolled SVG sparkline + tip histogram"`

---

### Task 9 — Panel components (TiersRow, PositionEstimator, CapabilityPanel, Banner)

**Files:**
- Create: `examples/gas-dashboard/src/components/TiersRow.tsx`
- Create: `examples/gas-dashboard/src/components/PositionEstimator.tsx`
- Create: `examples/gas-dashboard/src/components/CapabilityPanel.tsx`
- Create: `examples/gas-dashboard/src/components/Banner.tsx`

Not unit-tested — manual verification in Task 11.

**Steps:**

- [ ] Create `examples/gas-dashboard/src/components/TiersRow.tsx` — four tier cards from `state.tiers`:
  ```tsx
  import type { GasOracleState } from '@valve-tech/gas-oracle'
  import { TIER_LADDER } from '@valve-tech/gas-oracle'
  import { formatGwei } from '../lib/format'

  export const TiersRow = ({ tiers }: { tiers: GasOracleState['tiers'] }): JSX.Element => (
    <section className="tiers">
      {TIER_LADDER.map((name) => {
        const t = tiers[name]
        return (
          <div className="tier-card" key={name}>
            <h3>{name}</h3>
            <div>
              tip <strong>{formatGwei(t.maxPriorityFeePerGas)}</strong> gwei
            </div>
            <div className="muted">max {formatGwei(t.maxFeePerGas)} gwei</div>
          </div>
        )
      })}
    </section>
  )
  ```
- [ ] Create `examples/gas-dashboard/src/components/PositionEstimator.tsx` — tip input → percentile, capability-aware label:
  ```tsx
  import { useState } from 'react'
  import type { TipSample } from '@valve-tech/gas-oracle'
  import type { BlockPositionMode } from '../lib/capabilities'
  import { estimatePosition } from '../lib/position'
  import { formatGwei, formatWei } from '../lib/format'

  interface Props {
    /** The sample distribution to rank against (mempool+ring, or ring-only). */
    samples: TipSample[]
    mode: BlockPositionMode
  }

  const GWEI = 1_000_000_000n

  export const PositionEstimator = ({ samples, mode }: Props): JSX.Element => {
    const [gweiInput, setGweiInput] = useState('1')

    let tip = 0n
    try {
      // Accept decimal gwei; convert to wei. Fall back to 0 on garbage input.
      const [whole, frac = ''] = gweiInput.trim().split('.')
      const fracPadded = (frac + '000000000').slice(0, 9)
      tip = BigInt(whole || '0') * GWEI + BigInt(fracPadded || '0')
    } catch {
      tip = 0n
    }

    const est = estimatePosition(samples, tip)

    return (
      <div className="panel">
        <h3>Block-position estimator</h3>
        <p className="muted">
          ranking against{' '}
          {mode === 'mempool' ? 'live mempool + recent blocks' : 'recent block-included tips'} (
          {est.total} samples)
        </p>
        <label>
          your tip (gwei){' '}
          <input
            value={gweiInput}
            onChange={(e) => setGweiInput(e.target.value)}
            inputMode="decimal"
          />
        </label>
        {est.total === 0 ? (
          <p className="muted">No samples yet — wait for a block.</p>
        ) : (
          <ul>
            <li>
              rank <strong>#{est.rank}</strong> of {est.total} (top {100 - est.percentile}% pay
              more)
            </li>
            <li>
              percentile <strong>{est.percentile}</strong>
            </li>
            <li>gas ahead of you: {formatWei(est.gasAhead)}</li>
            <li className="muted">tip parsed as {formatGwei(tip)} gwei</li>
          </ul>
        )}
      </div>
    )
  }
  ```
- [ ] Create `examples/gas-dashboard/src/components/CapabilityPanel.tsx` — the teaching panel (probe + reducer inputs):
  ```tsx
  import type { Capabilities } from '@valve-tech/chain-source'
  import type { GasOracleState } from '@valve-tech/gas-oracle'
  import type { PanelState } from '../lib/capabilities'
  import { trendArrow } from '../lib/format'

  interface Props {
    caps: Capabilities | null
    panel: PanelState
    state: GasOracleState
  }

  export const CapabilityPanel = ({ caps, panel, state }: Props): JSX.Element => (
    <div className="panel">
      <h3>Capabilities &amp; reducer inputs</h3>
      <h4 className="muted">chain-source probe</h4>
      {caps ? (
        <ul>
          <li>newHeads: {caps.newHeads}</li>
          <li>newPendingTransactions: {caps.newPendingTransactions}</li>
          <li>txpoolContent: {caps.txpoolContent}</li>
          <li>receiptByHash: {caps.receiptByHash}</li>
          <li>transport: {panel.transport}</li>
        </ul>
      ) : (
        <p className="muted">probing…</p>
      )}
      <h4 className="muted">tiers = f(inputs)</h4>
      <ul>
        <li>base-fee trend: {trendArrow(state.baseFeeTrend)} {state.baseFeeTrend}</li>
        <li>block-included tips: {state.ring.reduce((n, b) => n + b.tips.length, 0)} samples in ring</li>
        <li>pending tips: {state.mempoolSamples.length} mempool samples</li>
        <li>pending gas demand: {state.mempool.pendingGasDemand.toString()}</li>
      </ul>
    </div>
  )
  ```
- [ ] Create `examples/gas-dashboard/src/components/Banner.tsx` — error banner (tx-history shape):
  ```tsx
  export const Banner = ({ message }: { message: string }): JSX.Element => (
    <div className="banner error" role="alert">
      {message}
    </div>
  )
  ```
- [ ] Verify build: `yarn workspace @valve-tech/example-gas-dashboard build` — expect PASS.
- [ ] Commit: `git add examples/gas-dashboard/src/components && git commit -m "feat(examples): gas-dashboard — tiers, estimator, capability, banner panels"`

---

### Task 10 — `App.tsx` (header + layout + lifecycle)

**Files:**
- Modify: `examples/gas-dashboard/src/App.tsx`

Wires everything: chain switcher + custom-RPC entry + live block number + capability badges in the header, tiers hero row, the 2×2 grid, and the dashboard teardown/rebuild on chain switch. Not unit-tested — manual verification in Task 11.

**Steps:**

- [ ] Replace `examples/gas-dashboard/src/App.tsx` placeholder with the full app:
  ```tsx
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
  ```
- [ ] Verify build: `yarn workspace @valve-tech/example-gas-dashboard build` — expect PASS (tsc strict + vite build).
- [ ] Run the full test suite to confirm nothing regressed: `yarn workspace @valve-tech/example-gas-dashboard test` — expect PASS (4 test files).
- [ ] Commit: `git add examples/gas-dashboard/src/App.tsx && git commit -m "feat(examples): gas-dashboard — App header, tiers hero, 2x2 grid, chain-switch lifecycle"`

---

### Task 11 — README + lint/typecheck/build gate + manual verification

**Files:**
- Create: `examples/gas-dashboard/README.md`

**Steps:**

- [ ] Create `examples/gas-dashboard/README.md` covering: what it demonstrates (chain-observation half — `chain-source` capability probe + `gas-oracle` tiers), the package wiring (one ChainSource → one gas-oracle, switch = teardown/rebuild), how to run (`yarn workspace @valve-tech/example-gas-dashboard dev`), the capability-degradation behavior (gated mempool → histogram notice + block-included estimator; no WS → poll badge), and that NO wallet is needed (read-only public RPC). Mirror the structure/tone of `examples/unchained-tx-history/README.md`.
- [ ] Run lint from the repo root: `yarn workspace @valve-tech/example-gas-dashboard lint` — expect PASS (no `no-explicit-any`, no unused vars). Fix any findings (common: an unused import after refactor, or an `any` that should be `unknown`).
- [ ] Run typecheck: `yarn workspace @valve-tech/example-gas-dashboard typecheck` — expect PASS.
- [ ] Run the CI gate: `yarn workspace @valve-tech/example-gas-dashboard build` — expect PASS.
- [ ] Confirm the example is picked up by the root aggregate scripts (it is auto-discovered via the `examples/*` workspace glob): `yarn workspaces foreach --all --exclude @valve-tech/evm-toolkit run test` from root should include `@valve-tech/example-gas-dashboard` — expect its 4 test files to run green. (Optional sanity check; do not block on unrelated package failures.)
- [ ] **Manual verification (not automated — live chain):** `yarn workspace @valve-tech/example-gas-dashboard dev`, open the served URL, and confirm:
  - The default chain (PulseChain) connects, the block number ticks, and tier cards populate within a few blocks.
  - Base-fee sparkline draws and updates per block.
  - On a gated-mempool public RPC, the histogram panel shows the "this RPC doesn't expose the mempool" notice and the estimator labels itself "recent block-included tips"; the `mempool` badge is dim.
  - Switching chains in the dropdown tears down and rebuilds (badges + block number reset, then repopulate).
  - Pasting an http(s) RPC detects the chain id, adds it, and switches to it; pasting garbage surfaces the error banner.
  - Typing a tip in the estimator updates the rank/percentile readout.
- [ ] Commit: `git add examples/gas-dashboard/README.md && git commit -m "docs(examples): gas-dashboard — README + verification gate"`
- [ ] Merge the feature branch to main with `git merge --no-ff` per the repo's no-PR workflow (the user is sole maintainer).

---

## Notes for the implementer

- **Versions move in lockstep.** Both `@valve-tech/chain-source` and `@valve-tech/gas-oracle` are at `0.18.0` today. If the repo has bumped by the time you implement, set the example `version` and the two `^0.x` dep ranges to match the current synced line (check `packages/gas-oracle/package.json`).
- **`tipForBlockPosition` signature confirmed from source** (`packages/gas-oracle/src/block-position.ts`): `tipForBlockPosition(samples: TipSample[], query)` where `query` is the discriminated union with **bigint** `rank`/`percentile` (the gas-oracle examples use `rank: 50n`; the AGENTS.md table showing `rank: number` is stale — trust the source/examples). `TipSample` is `{ tip: bigint; gas: bigint; txType?: number; hash?: string; address?: string; nonce?: string }`.
- **`GasOracleState` fields used:** `tiers` (hero + cutoffs), `baseFeeHistory: bigint[]` (sparkline), `baseFeeTrend: Trend` (capability panel), `mempoolSamples: TipSample[]` (histogram + estimator), `ring: BlockSample[]` (block-included fallback distribution; `BlockSample.tips: TipSample[]`), `mempool: MempoolStats` (pendingGasDemand), `blockNumber: bigint`.
- **Do not run `yarn verify:clean` or the full monorepo build** as part of this plan — the gate here is the per-workspace `build` + `test`. The cross-package release gates are out of scope for an example-only change.
- **`keepMempoolSnapshot: true`** is required for `state.mempoolSamples` to be populated; on a gated RPC it's simply empty (no throw), which the capability layer handles.
