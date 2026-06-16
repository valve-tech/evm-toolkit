# tx-write-flight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully static Vite + React + TS example app (`@valve-tech/example-tx-write-flight`) that demonstrates the write half of the evm-toolkit — pricing, sending with lifecycle hooks, tracking to terminal, rendering progress, classifying failures, and the speed-up / cancel replacement flow — across the six write-side packages.

**Architecture:** One `createChainSource(publicClient)` is created once per connected chain and fanned out to both `gas-oracle` and `tx-tracker` (Recipe 2 — never two poll loops on one RPC). The send path (Recipe 1) is: gas-oracle tier → `sendTransactionWithHooks` over a thin injected EIP-1193 `WalletAdapter` (`window.ethereum`) → `tx-flight-react`'s `useTxFlight().addWithWalletAdapter` for the strip → `tx-tracker.watchTransaction`-equivalent observations advance row states; every catch routes through `viem-errors`. Layout A is two panes (compose left, in-flight strip right) that stack on mobile, with the strip persisted via the localStorage storage adapter.

**Tech Stack:** Vite 5, React 18, TypeScript 5 (strict, `moduleResolution: Bundler`), viem ^2, vitest. Toolkit siblings consumed by package name at the synced `^0.18.0` line. No backend, no env secrets — everything baked is public.

---

## File Structure

Every file below is created under `examples/tx-write-flight/` unless noted. Each file has a single responsibility.

| File | Responsibility |
|---|---|
| `package.json` | Workspace manifest `@valve-tech/example-tx-write-flight`, `private: true`, scripts (`dev`/`build`/`preview`/`typecheck`/`lint`/`test`), deps on the six siblings + `viem`/`react`/`react-dom`. |
| `tsconfig.json` | Same compiler options as `unchained-tx-history` (ES2020, Bundler resolution, strict, `noUnusedLocals`). |
| `vite.config.ts` | Static build (`base: './'`, `outDir: dist`, `target: es2020`), `@vitejs/plugin-react`. |
| `index.html` | Single `#root` mount + `/src/main.tsx` module entry; minimal head/meta. |
| `src/vite-env.d.ts` | `/// <reference types="vite/client" />`. |
| `src/main.tsx` | React root render of `<App />` inside `<React.StrictMode>`. |
| `src/styles.css` | Control-panel / flight-board styling (two-pane grid, state-colored rows, mobile stack). |
| `src/config.ts` | Public build-time config: the chain → WETH address registry and the WETH `deposit()/withdraw()` ABI fragments; tiny default amounts. |
| `src/lib/weth.ts` | **Pure.** WETH registry lookup (`wethAddressFor`, `wethSupported`) — the "no WETH here → disable" decision. |
| `src/lib/weth.test.ts` | Tests for `weth.ts`. |
| `src/lib/format.ts` | **Pure.** Amount/fee/cost formatting (`formatEther`-style trimmed decimals, `formatGwei`, `shortHash`, `shortAddr`). |
| `src/lib/format.test.ts` | Tests for `format.ts`. |
| `src/lib/actions.ts` | **Pure.** `Action` type + `buildTransactionRequest` (action → `WalletSendTransactionRequest`) and `buildCancelRequest` (0-value self-send, same nonce → `ReplaceTransactionOriginal`). |
| `src/lib/actions.test.ts` | Tests for `actions.ts`. |
| `src/lib/wallet.ts` | Thin injected EIP-1193 `WalletAdapter` over `window.ethereum` (connect, chainId, `sendTransaction`), plus a viem `WalletClient` builder for replacement. |
| `src/lib/source.ts` | Per-chain singleton wiring: `createChainSource` once → `createGasOracle` + `createTxTracker` siblings; `PublicClient` factory for rehydrate. |
| `src/lib/chains.ts` | Resolve a connected chain id → viem chain object + display (name, native symbol, explorer). |
| `src/components/Header.tsx` | Connect/disconnect, address, chain name + native symbol, live block number. |
| `src/components/ComposePane.tsx` | Action selector, action fields, four gas-tier cards with live cost preview, Review & send confirm step. |
| `src/components/TierCards.tsx` | The four selectable tier cards + per-tier cost preview. |
| `src/components/FlightPane.tsx` | `<TxFlightList>` render with per-row state + Speed up / Cancel while pending. |
| `src/App.tsx` | Top-level layout: `<TxFlightProvider>` wraps Header + two-pane (ComposePane / FlightPane). Owns connection + source lifecycle + send/replace orchestration. |
| `README.md` | What it demonstrates, package wiring, how to run, which actions need WETH, testnet/mainnet caution, manual E2E steps. |

---

## Task 1 — Scaffold the workspace (build gate first)

**Files:**
- Create: `examples/tx-write-flight/package.json`
- Create: `examples/tx-write-flight/tsconfig.json`
- Create: `examples/tx-write-flight/vite.config.ts`
- Create: `examples/tx-write-flight/index.html`
- Create: `examples/tx-write-flight/src/vite-env.d.ts`
- Create: `examples/tx-write-flight/src/main.tsx`
- Create: `examples/tx-write-flight/src/App.tsx` (placeholder, replaced in Task 9)
- Create: `examples/tx-write-flight/src/styles.css` (skeleton, expanded in Task 9)

**Steps:**

- [ ] Create `examples/tx-write-flight/package.json` with the complete content:
  ```json
  {
    "name": "@valve-tech/example-tx-write-flight",
    "version": "0.18.0",
    "private": true,
    "description": "Static web app demonstrating the write half of the evm-toolkit: price a transaction with @valve-tech/gas-oracle, send it through an injected EIP-1193 @valve-tech/wallet-adapter, render it in the @valve-tech/tx-flight-react in-flight strip, track it to a terminal state with @valve-tech/tx-tracker over one shared @valve-tech/chain-source, and classify failures with @valve-tech/viem-errors. Three actions (native send, wrap, unwrap) plus speed-up and cancel.",
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
      "@valve-tech/tx-tracker": "^0.18.0",
      "@valve-tech/viem-errors": "^0.18.0",
      "@valve-tech/wallet-adapter": "^0.18.0",
      "@valve-tech/tx-flight-react": "^0.18.0",
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
- [ ] Create `examples/tx-write-flight/tsconfig.json` (identical to `unchained-tx-history`):
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
- [ ] Create `examples/tx-write-flight/vite.config.ts`:
  ```ts
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'

  // Fully static output — no server code, no env secrets. Every baked
  // constant (WETH addresses, default amounts) is public by definition.
  // Deploy = copy dist/ to a web root.
  export default defineConfig({
    plugins: [react()],
    base: './',
    build: { outDir: 'dist', target: 'es2020' },
  })
  ```
- [ ] Create `examples/tx-write-flight/index.html`:
  ```html
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>tx-write-flight — price, send, track, replace</title>
      <meta
        name="description"
        content="Price a transaction with gas-oracle, send it through an injected EIP-1193 wallet, render it in an in-flight strip, track it to a terminal state, and classify failures — plus speed-up and cancel. Built on @valve-tech/* evm-toolkit packages."
      />
      <meta name="theme-color" content="#0b0e14" />
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="/src/main.tsx"></script>
    </body>
  </html>
  ```
- [ ] Create `examples/tx-write-flight/src/vite-env.d.ts`:
  ```ts
  /// <reference types="vite/client" />
  ```
- [ ] Create `examples/tx-write-flight/src/main.tsx`:
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
- [ ] Create a placeholder `examples/tx-write-flight/src/App.tsx` so the build passes before later tasks fill it in:
  ```tsx
  export const App = (): JSX.Element => <div>tx-write-flight</div>
  ```
- [ ] Create a skeleton `examples/tx-write-flight/src/styles.css`:
  ```css
  :root { color-scheme: dark; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
  ```
- [ ] Install so the workspace is linked into the monorepo: run `yarn install`. Expected: lockfile resolves `@valve-tech/example-tx-write-flight` with no errors.
- [ ] Verify typecheck of the skeleton: run `yarn workspace @valve-tech/example-tx-write-flight run typecheck`. Expected: exits 0 (no type errors).
- [ ] Commit: `git add examples/tx-write-flight && git commit -m "feat(examples): tx-write-flight — scaffold workspace (vite+react+ts, six-package deps)"`

---

## Task 2 — WETH registry (pure logic, TDD)

The chain → WETH address registry and the "no WETH here → disable" decision. Wrap/unwrap are gated on this.

**Files:**
- Create: `examples/tx-write-flight/src/config.ts`
- Create: `examples/tx-write-flight/src/lib/weth.ts`
- Test: `examples/tx-write-flight/src/lib/weth.test.ts`

**Steps:**

- [ ] Create `examples/tx-write-flight/src/config.ts` with the registry and ABI fragments:
  ```ts
  /**
   * Build-time configuration — everything here is PUBLIC. A static site holds
   * no secrets. The WETH registry maps a chain id to that chain's canonical
   * wrapped-native (WETH9-style) contract; chains absent from the map disable
   * the Wrap / Unwrap actions (native send still works everywhere).
   */
  import type { Hex } from 'viem'

  /** Canonical WETH9-style wrapped-native address per chain id. */
  export const WETH_BY_CHAIN: Readonly<Record<number, Hex>> = {
    1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // Ethereum mainnet WETH9
    10: '0x4200000000000000000000000000000000000006', // OP Mainnet WETH
    8453: '0x4200000000000000000000000000000000000006', // Base WETH
    42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // Arbitrum One WETH
    11155111: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', // Sepolia WETH
  }

  /** Minimal WETH9 ABI — only deposit()/withdraw() are exercised. */
  export const WETH_ABI = [
    { type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [], outputs: [] },
    {
      type: 'function',
      name: 'withdraw',
      stateMutability: 'nonpayable',
      inputs: [{ name: 'wad', type: 'uint256' }],
      outputs: [],
    },
  ] as const

  /** Tiny defaults so accidental mainnet sends stay cheap. In wei (1e15 = 0.001). */
  export const DEFAULT_NATIVE_WEI = 1_000_000_000_000_000n // 0.001
  export const DEFAULT_WRAP_WEI = 1_000_000_000_000_000n // 0.001
  export const DEFAULT_UNWRAP_WEI = 1_000_000_000_000_000n // 0.001
  ```
- [ ] Write the failing test `examples/tx-write-flight/src/lib/weth.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'

  import { wethAddressFor, wethSupported } from './weth'

  describe('WETH registry', () => {
    it('returns the canonical WETH address for a known chain', () => {
      expect(wethAddressFor(1)).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
      expect(wethAddressFor(8453)).toBe('0x4200000000000000000000000000000000000006')
    })

    it('returns null for a chain with no registered WETH', () => {
      expect(wethAddressFor(369)).toBeNull()
      expect(wethAddressFor(999999)).toBeNull()
    })

    it('wethSupported is the disable decision: true iff registered', () => {
      expect(wethSupported(1)).toBe(true)
      expect(wethSupported(42161)).toBe(true)
      expect(wethSupported(369)).toBe(false)
    })
  })
  ```
- [ ] Run the test (expected FAIL — `weth.ts` does not exist): `yarn workspace @valve-tech/example-tx-write-flight run test`. Expected output: `Error: Failed to resolve import "./weth"` / suite fails.
- [ ] Create the minimal implementation `examples/tx-write-flight/src/lib/weth.ts`:
  ```ts
  /** Pure WETH-registry lookups. The disable decision for Wrap / Unwrap. */
  import type { Hex } from 'viem'

  import { WETH_BY_CHAIN } from '../config'

  /** Canonical WETH address for a chain id, or null when unregistered. */
  export const wethAddressFor = (chainId: number): Hex | null =>
    WETH_BY_CHAIN[chainId] ?? null

  /** True iff this chain has a registered WETH — i.e. Wrap / Unwrap are enabled. */
  export const wethSupported = (chainId: number): boolean =>
    wethAddressFor(chainId) !== null
  ```
- [ ] Run the test (expected PASS): `yarn workspace @valve-tech/example-tx-write-flight run test`. Expected: `weth.test.ts` 3 passing.
- [ ] Commit: `git add examples/tx-write-flight/src/config.ts examples/tx-write-flight/src/lib/weth.ts examples/tx-write-flight/src/lib/weth.test.ts && git commit -m "feat(examples): tx-write-flight — WETH registry + disable decision (pure, tested)"`

---

## Task 3 — Amount / fee formatting (pure logic, TDD)

**Files:**
- Create: `examples/tx-write-flight/src/lib/format.ts`
- Test: `examples/tx-write-flight/src/lib/format.test.ts`

**Steps:**

- [ ] Write the failing test `examples/tx-write-flight/src/lib/format.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'

  import {
    formatAmount,
    formatGwei,
    estimateCostWei,
    shortHash,
    shortAddr,
  } from './format'

  describe('format helpers', () => {
    it('formats wei into a trimmed native-unit decimal', () => {
      expect(formatAmount(0n)).toBe('0')
      expect(formatAmount(10n ** 18n)).toBe('1')
      expect(formatAmount(1_500_000_000_000_000_000n)).toBe('1.5')
      expect(formatAmount(1_000_000_000_000_000n)).toBe('0.001')
    })

    it('formats a fee in gwei', () => {
      expect(formatGwei(0n)).toBe('0')
      expect(formatGwei(1_000_000_000n)).toBe('1')
      expect(formatGwei(1_500_000_000n)).toBe('1.5')
    })

    it('estimates total fee cost as gasLimit * maxFeePerGas', () => {
      expect(estimateCostWei(21_000n, 20_000_000_000n)).toBe(420_000_000_000_000n)
    })

    it('shortens hashes and addresses', () => {
      expect(shortAddr('0x002c67e5f1d6eec758e1ec02087f2e63c869d18c')).toBe('0x002c…d18c')
      expect(shortHash('0x' + 'a'.repeat(64))).toMatch(/^0xaaaaaaaa…aaaaaaaa$/)
    })
  })
  ```
- [ ] Run the test (expected FAIL — `format.ts` missing): `yarn workspace @valve-tech/example-tx-write-flight run test`. Expected: `Failed to resolve import "./format"`.
- [ ] Create `examples/tx-write-flight/src/lib/format.ts`:
  ```ts
  /** Display + cost helpers — all pure. */

  /** Trim a fixed-decimal bigint to a clean decimal string (max 6 frac digits). */
  const trimUnits = (value: bigint, decimals: number): string => {
    if (value === 0n) return '0'
    const base = 10n ** BigInt(decimals)
    const whole = value / base
    const frac = value % base
    if (frac === 0n) return whole.toString()
    const fracStr = frac
      .toString()
      .padStart(decimals, '0')
      .replace(/0+$/, '')
      .slice(0, 6)
    return `${whole.toString()}.${fracStr}`
  }

  /** Format a wei value as a decimal string in the chain's native unit (18dp). */
  export const formatAmount = (wei: bigint): string => trimUnits(wei, 18)

  /** Format a wei-per-gas fee as gwei (9dp). */
  export const formatGwei = (wei: bigint): string => trimUnits(wei, 9)

  /** Worst-case fee cost in wei: gasLimit * maxFeePerGas. */
  export const estimateCostWei = (gasLimit: bigint, maxFeePerGas: bigint): bigint =>
    gasLimit * maxFeePerGas

  export const shortHash = (h: string, lead = 10, tail = 8): string =>
    h.length <= lead + tail ? h : `${h.slice(0, lead)}…${h.slice(-tail)}`

  export const shortAddr = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`
  ```
- [ ] Run the test (expected PASS): `yarn workspace @valve-tech/example-tx-write-flight run test`. Expected: `format.test.ts` 4 passing (plus `weth.test.ts` still passing).
- [ ] Commit: `git add examples/tx-write-flight/src/lib/format.ts examples/tx-write-flight/src/lib/format.test.ts && git commit -m "feat(examples): tx-write-flight — amount/fee/cost formatting (pure, tested)"`

---

## Task 4 — action → transaction-request mapping + cancel builder (pure logic, TDD)

The action-to-`WalletSendTransactionRequest` mapping (native send / wrap / unwrap) and the cancel request builder (0-value self-send, same nonce). These are the load-bearing send-path translations.

**Files:**
- Create: `examples/tx-write-flight/src/lib/actions.ts`
- Test: `examples/tx-write-flight/src/lib/actions.test.ts`

**Steps:**

- [ ] Write the failing test `examples/tx-write-flight/src/lib/actions.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import type { Hex } from 'viem'

  import { buildTransactionRequest, buildCancelRequest } from './actions'

  const FROM = '0x1111111111111111111111111111111111111111' as Hex
  const TO = '0x2222222222222222222222222222222222222222' as Hex
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Hex
  const GAS = { maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n }

  describe('buildTransactionRequest', () => {
    it('native send → value transfer to the recipient, empty calldata', () => {
      const req = buildTransactionRequest(
        { kind: 'send', to: TO, amountWei: 5n },
        { chainId: 1, from: FROM, weth: WETH, gas: GAS },
      )
      expect(req).toEqual({
        to: TO,
        data: '0x',
        value: 5n,
        chainId: 1,
        maxFeePerGas: 30_000_000_000n,
        maxPriorityFeePerGas: 2_000_000_000n,
      })
    })

    it('wrap → payable deposit() on WETH, value = amount, to = WETH', () => {
      const req = buildTransactionRequest(
        { kind: 'wrap', amountWei: 1_000n },
        { chainId: 1, from: FROM, weth: WETH, gas: GAS },
      )
      expect(req.to).toBe(WETH)
      expect(req.value).toBe(1_000n)
      // deposit() selector
      expect(req.data).toBe('0xd0e30db0')
    })

    it('unwrap → withdraw(amount) on WETH, zero value, encoded arg', () => {
      const req = buildTransactionRequest(
        { kind: 'unwrap', amountWei: 1_000n },
        { chainId: 1, from: FROM, weth: WETH, gas: GAS },
      )
      expect(req.to).toBe(WETH)
      expect(req.value).toBe(0n)
      // withdraw(uint256) selector + 32-byte arg = 0x3e8
      expect(req.data).toBe(
        '0x2e1a7d4d00000000000000000000000000000000000000000000000000000000000003e8',
      )
    })
  })

  describe('buildCancelRequest', () => {
    it('is a 0-value self-send on the same nonce', () => {
      const cancel = buildCancelRequest({ from: FROM, chainId: 1, nonce: 42 })
      expect(cancel).toEqual({ to: FROM, value: 0n, nonce: 42, chainId: 1, data: '0x' })
    })
  })
  ```
- [ ] Run the test (expected FAIL — `actions.ts` missing): `yarn workspace @valve-tech/example-tx-write-flight run test`. Expected: `Failed to resolve import "./actions"`.
- [ ] Create `examples/tx-write-flight/src/lib/actions.ts`:
  ```ts
  /**
   * Pure mapping from a UI Action to the wallet-adapter request shape, plus the
   * cancel-tx builder. No I/O, no wallet calls — these are the testable seams of
   * the send path. The fee fields come from a gas-oracle tier (see TierRecommendation).
   */
  import { encodeFunctionData, type Hex } from 'viem'
  import type {
    WalletSendTransactionRequest,
  } from '@valve-tech/wallet-adapter'
  import type { ReplaceTransactionOriginal } from '@valve-tech/tx-tracker'

  import { WETH_ABI } from '../config'

  /** The three anchor actions, each driving a different lifecycle path. */
  export type Action =
    | { kind: 'send'; to: Hex; amountWei: bigint }
    | { kind: 'wrap'; amountWei: bigint }
    | { kind: 'unwrap'; amountWei: bigint }

  /** Resolved fee fields from a gas-oracle TierRecommendation. */
  export interface ResolvedGas {
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
  }

  export interface BuildContext {
    chainId: number
    from: Hex
    /** Canonical WETH address — required for wrap/unwrap; ignored for send. */
    weth: Hex | null
    gas: ResolvedGas
  }

  /** Map an Action + context to the wallet-adapter request. */
  export const buildTransactionRequest = (
    action: Action,
    ctx: BuildContext,
  ): WalletSendTransactionRequest => {
    const fee = {
      chainId: ctx.chainId,
      maxFeePerGas: ctx.gas.maxFeePerGas,
      maxPriorityFeePerGas: ctx.gas.maxPriorityFeePerGas,
    }
    switch (action.kind) {
      case 'send':
        return { to: action.to, data: '0x', value: action.amountWei, ...fee }
      case 'wrap': {
        if (!ctx.weth) throw new Error('wrap requires a WETH address for this chain')
        return {
          to: ctx.weth,
          data: encodeFunctionData({ abi: WETH_ABI, functionName: 'deposit' }),
          value: action.amountWei,
          ...fee,
        }
      }
      case 'unwrap': {
        if (!ctx.weth) throw new Error('unwrap requires a WETH address for this chain')
        return {
          to: ctx.weth,
          data: encodeFunctionData({
            abi: WETH_ABI,
            functionName: 'withdraw',
            args: [action.amountWei],
          }),
          value: 0n,
          ...fee,
        }
      }
    }
  }

  export interface CancelContext {
    from: Hex
    chainId: number
    nonce: number
  }

  /**
   * A cancel is a 0-value self-send on the SAME nonce. Returned as a
   * `ReplaceTransactionOriginal` so it can be threaded straight into
   * `replaceTransaction` with a bumped gas params object.
   */
  export const buildCancelRequest = (
    ctx: CancelContext,
  ): ReplaceTransactionOriginal => ({
    to: ctx.from,
    value: 0n,
    nonce: ctx.nonce,
    chainId: ctx.chainId,
    data: '0x',
  })
  ```
- [ ] Run the test (expected PASS): `yarn workspace @valve-tech/example-tx-write-flight run test`. Expected: `actions.test.ts` 4 passing (all three suites green).
- [ ] Commit: `git add examples/tx-write-flight/src/lib/actions.ts examples/tx-write-flight/src/lib/actions.test.ts && git commit -m "feat(examples): tx-write-flight — action→request mapping + cancel builder (pure, tested)"`

---

## Task 5 — Chain resolution helper (implementation, no unit test)

Resolve the connected chain id to a viem chain object + display metadata. Reading `viem/chains` lazily is fine; if the chain isn't in viem's registry, fall back to a minimal definition. Not unit-tested (it's a thin lookup over viem's registry).

**Files:**
- Create: `examples/tx-write-flight/src/lib/chains.ts`

**Steps:**

- [ ] Create `examples/tx-write-flight/src/lib/chains.ts`:
  ```ts
  /**
   * Resolve a connected chain id to a viem Chain (for PublicClient/WalletClient)
   * plus display fields. viem/chains is large, so it's imported lazily and
   * cached; an unknown chain id falls back to a minimal synthetic chain so the
   * app still follows the wallet onto exotic networks.
   */
  import { defineChain, type Chain } from 'viem'

  export interface ChainDisplay {
    chain: Chain
    label: string
    symbol: string
    explorerUrl: string | null
  }

  let registryCache: Chain[] | null = null

  const loadRegistry = async (): Promise<Chain[]> => {
    if (!registryCache) {
      const mod = await import('viem/chains')
      registryCache = (Object.values(mod) as unknown[]).filter(
        (c): c is Chain =>
          typeof c === 'object' &&
          c !== null &&
          typeof (c as { id?: unknown }).id === 'number',
      )
    }
    return registryCache
  }

  const fallbackChain = (chainId: number, rpcUrl: string): Chain =>
    defineChain({
      id: chainId,
      name: `Chain ${chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    })

  /**
   * Build a ChainDisplay for the connected chain. `rpcUrl` is the wallet's own
   * RPC endpoint (the EIP-1193 provider) — used as the http transport URL so
   * reads go through the same node the wallet uses.
   */
  export const resolveChain = async (
    chainId: number,
    rpcUrl: string,
  ): Promise<ChainDisplay> => {
    const known = (await loadRegistry()).find((c) => c.id === chainId)
    const chain = known ?? fallbackChain(chainId, rpcUrl)
    return {
      chain,
      label: chain.name,
      symbol: chain.nativeCurrency.symbol,
      explorerUrl: chain.blockExplorers?.default.url ?? null,
    }
  }
  ```
- [ ] Verify typecheck: `yarn workspace @valve-tech/example-tx-write-flight run typecheck`. Expected: exits 0.
- [ ] Commit: `git add examples/tx-write-flight/src/lib/chains.ts && git commit -m "feat(examples): tx-write-flight — connected-chain resolution helper"`

---

## Task 6 — Injected EIP-1193 WalletAdapter (implementation, manual verify)

A thin `WalletAdapter` over `window.ethereum` — the teaching point for implementing the interface against any EIP-1193 provider. Also a viem `WalletClient` builder needed by `replaceTransaction`. Not unit-tested (no wallet in CI); manual verification noted.

**Files:**
- Create: `examples/tx-write-flight/src/lib/wallet.ts`

**Steps:**

- [ ] Create `examples/tx-write-flight/src/lib/wallet.ts`:
  ```ts
  /**
   * A thin EIP-1193 WalletAdapter over window.ethereum (MetaMask / Rabby / etc).
   * No project IDs, no connector config — this shows exactly how to implement
   * the @valve-tech/wallet-adapter `WalletAdapter` interface against any injected
   * provider. The same provider also backs a viem WalletClient for the
   * replacement (speed-up / cancel) path, which needs nonce control.
   */
  import {
    createWalletClient,
    custom,
    numberToHex,
    type Chain,
    type Hex,
    type WalletClient,
  } from 'viem'
  import type {
    WalletAdapter,
    WalletSendTransactionRequest,
  } from '@valve-tech/wallet-adapter'

  /** The minimal EIP-1193 surface we rely on. */
  export interface Eip1193Provider {
    request(args: { method: string; params?: unknown[] }): Promise<unknown>
    on?(event: string, handler: (...args: unknown[]) => void): void
    removeListener?(event: string, handler: (...args: unknown[]) => void): void
  }

  export const getInjectedProvider = (): Eip1193Provider | null => {
    const eth = (globalThis as { ethereum?: Eip1193Provider }).ethereum
    return eth ?? null
  }

  /** Prompt the wallet to connect; returns the selected account (lowercased Hex). */
  export const connect = async (
    provider: Eip1193Provider,
  ): Promise<Hex> => {
    const accounts = (await provider.request({
      method: 'eth_requestAccounts',
    })) as string[]
    if (!accounts.length) throw new Error('No account returned by wallet')
    return accounts[0] as Hex
  }

  /** The wallet's currently-connected chain id. */
  export const getChainId = async (
    provider: Eip1193Provider,
  ): Promise<number> => {
    const hex = (await provider.request({ method: 'eth_chainId' })) as string
    return Number(BigInt(hex))
  }

  /**
   * Build a WalletAdapter from an injected provider + connected account. It
   * validates request.chainId against the provider's chain and throws on
   * mismatch (the WalletAdapter contract: never silently sign for the wrong
   * network). The wallet supplies the EIP-1559 fee fields straight from the
   * request (which carry the chosen gas-oracle tier).
   */
  export const injectedWalletAdapter = (
    provider: Eip1193Provider,
    account: Hex,
  ): WalletAdapter => ({
    address: account,
    sendTransaction: async (
      request: WalletSendTransactionRequest,
    ): Promise<Hex> => {
      const walletChainId = await getChainId(provider)
      if (walletChainId !== request.chainId) {
        throw new Error(
          `WalletAdapter: wallet is on chain ${walletChainId}, request is ` +
            `for chain ${request.chainId}. Switch network in your wallet first.`,
        )
      }
      const tx: Record<string, string> = {
        from: account,
        to: request.to,
        data: request.data,
        value: numberToHex(request.value ?? 0n),
      }
      if (request.maxFeePerGas !== undefined)
        tx.maxFeePerGas = numberToHex(request.maxFeePerGas)
      if (request.maxPriorityFeePerGas !== undefined)
        tx.maxPriorityFeePerGas = numberToHex(request.maxPriorityFeePerGas)
      const hash = (await provider.request({
        method: 'eth_sendTransaction',
        params: [tx],
      })) as string
      return hash as Hex
    },
  })

  /**
   * A viem WalletClient over the same injected provider, bound to the connected
   * account + chain. Needed by `replaceTransaction`, which sets an explicit
   * `nonce` (the WalletAdapter request shape has no nonce field).
   */
  export const injectedWalletClient = (
    provider: Eip1193Provider,
    account: Hex,
    chain: Chain,
  ): WalletClient =>
    createWalletClient({
      account,
      chain,
      transport: custom(provider),
    })
  ```
- [ ] Verify typecheck: `yarn workspace @valve-tech/example-tx-write-flight run typecheck`. Expected: exits 0.
- [ ] **Manual verification note (no CI):** with a browser wallet installed, `connect()` opens the wallet prompt, `injectedWalletAdapter(...).sendTransaction(req)` returns a hash, and a chain mismatch throws the descriptive error. Verified by hand during the end-to-end run in Task 10.
- [ ] Commit: `git add examples/tx-write-flight/src/lib/wallet.ts && git commit -m "feat(examples): tx-write-flight — thin injected EIP-1193 WalletAdapter + WalletClient"`

---

## Task 7 — Shared ChainSource → gas-oracle + tx-tracker wiring (implementation, manual verify)

One `createChainSource(publicClient)` per connected chain, fanned out to a sibling `gas-oracle` and `tx-tracker` (Recipe 2 — one poll loop). Also the `PublicClient` factory used by `tx-flight-react`'s rehydrate `clientFactory`. Not unit-tested (needs a live RPC); manual verification noted.

**Files:**
- Create: `examples/tx-write-flight/src/lib/source.ts`

**Steps:**

- [ ] Create `examples/tx-write-flight/src/lib/source.ts`:
  ```ts
  /**
   * Recipe 2: ONE ChainSource per chain, fanned out to gas-oracle AND tx-tracker.
   * Never two poll loops against one RPC. The oracle and tracker are siblings
   * over one source — neither is layered on the other. Cached per chain id so a
   * reconnect to the same chain reuses the running poll loop.
   */
  import { createPublicClient, custom, type Chain, type PublicClient } from 'viem'
  import { createChainSource, type ChainSource } from '@valve-tech/chain-source'
  import { createGasOracle, type GasOracle } from '@valve-tech/gas-oracle'
  import { createTxTracker, type TxTracker } from '@valve-tech/tx-tracker'

  import type { Eip1193Provider } from './wallet'

  export interface ChainStack {
    client: PublicClient
    source: ChainSource
    oracle: GasOracle
    tracker: TxTracker
    stop: () => void
  }

  const stacks = new Map<number, ChainStack>()

  /** A viem PublicClient over the injected provider for a chain. */
  export const publicClientFor = (
    provider: Eip1193Provider,
    chain: Chain,
  ): PublicClient =>
    createPublicClient({ chain, transport: custom(provider) })

  /**
   * Get (or build) the running stack for a chain. The oracle needs at least one
   * subscriber to poll (pauseWhenIdle default), so we keep `pauseWhenIdle: false`
   * to guarantee `getState()` populates for the cost preview without forcing the
   * UI to subscribe.
   */
  export const getChainStack = (
    provider: Eip1193Provider,
    chain: Chain,
  ): ChainStack => {
    const existing = stacks.get(chain.id)
    if (existing) return existing

    const client = publicClientFor(provider, chain)
    const source = createChainSource({ client })
    const oracle = createGasOracle({
      source,
      chainId: chain.id,
      priorityModel: 'eip1559',
      pauseWhenIdle: false,
    })
    const tracker = createTxTracker({ source, chainId: chain.id })

    source.start()
    oracle.start()
    tracker.start()

    const stack: ChainStack = {
      client,
      source,
      oracle,
      tracker,
      stop: () => {
        oracle.stop()
        tracker.stop()
        source.stop()
        stacks.delete(chain.id)
      },
    }
    stacks.set(chain.id, stack)
    return stack
  }

  /**
   * Module-level PublicClient registry keyed by chain id — used as the
   * `clientFactory` for tx-flight-react rehydrate. Must not capture rendered
   * state (called at Provider mount per pending entry).
   */
  const clients = new Map<number, PublicClient>()
  export const registerClient = (chainId: number, client: PublicClient): void => {
    clients.set(chainId, client)
  }
  export const clientFactory = (chainId: number): PublicClient | undefined =>
    clients.get(chainId)
  ```
- [ ] Verify the `pauseWhenIdle` and constructor option names against the installed package surface: `grep -n "pauseWhenIdle\|priorityModel" node_modules/@valve-tech/gas-oracle/dist/*.d.ts | head`. Expected: both options appear on the gas-oracle options type. If `createGasOracle` requires `client` instead of `source` in the installed version, switch to the `source`-based composition shown in the tx-tracker AGENTS.md ("Composing with gas-oracle"). (The AGENTS.md examples use `source`.)
- [ ] Verify typecheck: `yarn workspace @valve-tech/example-tx-write-flight run typecheck`. Expected: exits 0.
- [ ] **Manual verification note (no CI):** against a live wallet RPC, `getChainStack(...)` starts exactly one poll loop; `oracle.getState()?.tiers` populates within a few blocks and feeds the cost preview; `tracker` advances rows. Verified during Task 10.
- [ ] Commit: `git add examples/tx-write-flight/src/lib/source.ts && git commit -m "feat(examples): tx-write-flight — one shared ChainSource → gas-oracle + tx-tracker (Recipe 2)"`

---

## Task 8 — Tier cards + compose pane (implementation, manual verify)

The four gas-tier cards with live per-tier cost preview, the action selector + action fields, and the Review & send confirm step. Disabled Wrap/Unwrap off-registry. Not unit-tested (React UI); manual verification noted.

**Files:**
- Create: `examples/tx-write-flight/src/components/TierCards.tsx`
- Create: `examples/tx-write-flight/src/components/ComposePane.tsx`

**Steps:**

- [ ] Create `examples/tx-write-flight/src/components/TierCards.tsx`:
  ```tsx
  /**
   * The four gas-oracle tiers (slow/standard/fast/instant) as selectable cards,
   * each showing its maxFee (gwei) and the previewed total fee cost
   * (gasLimit * maxFeePerGas) in the native unit.
   */
  import type { TierName, TierRecommendation } from '@valve-tech/gas-oracle'

  import { estimateCostWei, formatAmount, formatGwei } from '../lib/format'

  const TIERS: readonly TierName[] = ['slow', 'standard', 'fast', 'instant']

  export interface TierCardsProps {
    tiers: Record<TierName, TierRecommendation> | null
    selected: TierName
    gasLimit: bigint
    symbol: string
    onSelect: (tier: TierName) => void
  }

  export const TierCards = ({
    tiers,
    selected,
    gasLimit,
    symbol,
    onSelect,
  }: TierCardsProps): JSX.Element => (
    <div className="tier-cards" role="radiogroup" aria-label="Gas tier">
      {TIERS.map((tier) => {
        const rec = tiers?.[tier]
        const cost = rec ? estimateCostWei(gasLimit, rec.maxFeePerGas) : null
        return (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={selected === tier}
            className={`tier-card${selected === tier ? ' tier-card--active' : ''}`}
            disabled={!rec}
            onClick={() => onSelect(tier)}
          >
            <span className="tier-card__name">{tier}</span>
            <span className="tier-card__fee">
              {rec ? `${formatGwei(rec.maxFeePerGas)} gwei` : '—'}
            </span>
            <span className="tier-card__cost">
              {cost !== null ? `≈ ${formatAmount(cost)} ${symbol}` : 'warming up…'}
            </span>
          </button>
        )
      })}
    </div>
  )
  ```
- [ ] Create `examples/tx-write-flight/src/components/ComposePane.tsx`:
  ```tsx
  /**
   * Compose pane: action selector (Send / Wrap / Unwrap, the last two disabled
   * off-registry), action-specific fields, the tier cards, and a Review & send
   * step that shows the resolved fee + total before the wallet prompt.
   */
  import { useState } from 'react'
  import type { Hex } from 'viem'
  import type { TierName, TierRecommendation } from '@valve-tech/gas-oracle'

  import type { Action } from '../lib/actions'
  import { estimateCostWei, formatAmount, formatGwei } from '../lib/format'
  import {
    DEFAULT_NATIVE_WEI,
    DEFAULT_UNWRAP_WEI,
    DEFAULT_WRAP_WEI,
  } from '../config'
  import { TierCards } from './TierCards'

  type ActionKind = Action['kind']

  export interface ComposePaneProps {
    connected: boolean
    account: Hex | null
    symbol: string
    wethSupported: boolean
    tiers: Record<TierName, TierRecommendation> | null
    selectedTier: TierName
    gasLimit: bigint
    onSelectTier: (tier: TierName) => void
    onSend: (action: Action) => void
    busy: boolean
  }

  // Static, conservative gas-limit estimates per action for the cost preview.
  const ETH_DECIMALS = 18
  const weiFromEthInput = (input: string): bigint => {
    const [whole = '0', frac = ''] = input.trim().split('.')
    const padded = (frac + '0'.repeat(ETH_DECIMALS)).slice(0, ETH_DECIMALS)
    return BigInt(whole || '0') * 10n ** BigInt(ETH_DECIMALS) + BigInt(padded || '0')
  }

  export const ComposePane = ({
    connected,
    account,
    symbol,
    wethSupported,
    tiers,
    selectedTier,
    gasLimit,
    onSelectTier,
    onSend,
    busy,
  }: ComposePaneProps): JSX.Element => {
    const [kind, setKind] = useState<ActionKind>('send')
    const [to, setTo] = useState<string>(account ?? '')
    const [amount, setAmount] = useState<string>('0.001')
    const [reviewing, setReviewing] = useState(false)

    const amountWei =
      amount.trim() === ''
        ? kind === 'send'
          ? DEFAULT_NATIVE_WEI
          : kind === 'wrap'
            ? DEFAULT_WRAP_WEI
            : DEFAULT_UNWRAP_WEI
        : weiFromEthInput(amount)

    const rec = tiers?.[selectedTier] ?? null
    const costWei = rec ? estimateCostWei(gasLimit, rec.maxFeePerGas) : null

    const buildAction = (): Action => {
      if (kind === 'send')
        return { kind: 'send', to: (to || account || '0x') as Hex, amountWei }
      if (kind === 'wrap') return { kind: 'wrap', amountWei }
      return { kind: 'unwrap', amountWei }
    }

    return (
      <section className="pane pane--compose">
        <h2>Compose</h2>

        <div className="action-selector" role="tablist">
          {(['send', 'wrap', 'unwrap'] as const).map((k) => {
            const disabled = k !== 'send' && !wethSupported
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                className={`action-tab${kind === k ? ' action-tab--active' : ''}`}
                disabled={disabled}
                title={disabled ? 'No canonical WETH registered for this chain' : undefined}
                onClick={() => {
                  setKind(k)
                  setReviewing(false)
                }}
              >
                {k === 'send' ? 'Native send' : k === 'wrap' ? 'Wrap → WETH' : 'Unwrap → ETH'}
              </button>
            )
          })}
        </div>

        <div className="fields">
          {kind === 'send' && (
            <label>
              Recipient
              <input
                value={to}
                placeholder={account ?? '0x…'}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          )}
          <label>
            Amount ({kind === 'unwrap' ? 'WETH' : symbol})
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </label>
        </div>

        <TierCards
          tiers={tiers}
          selected={selectedTier}
          gasLimit={gasLimit}
          symbol={symbol}
          onSelect={onSelectTier}
        />

        {!reviewing ? (
          <button
            type="button"
            className="primary"
            disabled={!connected || busy}
            onClick={() => setReviewing(true)}
          >
            Review &amp; send
          </button>
        ) : (
          <div className="review">
            <h3>Review &amp; send</h3>
            <dl>
              <dt>Action</dt>
              <dd>{kind}</dd>
              <dt>Amount</dt>
              <dd>{formatAmount(amountWei)} {kind === 'unwrap' ? 'WETH' : symbol}</dd>
              <dt>Tier</dt>
              <dd>{selectedTier}</dd>
              <dt>Max fee</dt>
              <dd>{rec ? `${formatGwei(rec.maxFeePerGas)} gwei` : '—'}</dd>
              <dt>Est. fee cost</dt>
              <dd>{costWei !== null ? `≈ ${formatAmount(costWei)} ${symbol}` : '—'}</dd>
            </dl>
            <div className="review__actions">
              <button type="button" onClick={() => setReviewing(false)}>Back</button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  onSend(buildAction())
                  setReviewing(false)
                }}
              >
                Confirm in wallet
              </button>
            </div>
          </div>
        )}
      </section>
    )
  }
  ```
- [ ] Verify typecheck: `yarn workspace @valve-tech/example-tx-write-flight run typecheck`. Expected: exits 0.
- [ ] **Manual verification note (no CI):** the four tier cards populate from `oracle.getState()`, each showing gwei + native-unit cost; Wrap/Unwrap tabs are disabled (with tooltip) off-registry; the Review step shows resolved fee + total before any wallet prompt. Verified in Task 10.
- [ ] Commit: `git add examples/tx-write-flight/src/components/TierCards.tsx examples/tx-write-flight/src/components/ComposePane.tsx && git commit -m "feat(examples): tx-write-flight — tier cards + compose pane (review & send)"`

---

## Task 9 — Header, flight pane, App orchestration + styles (implementation, manual verify)

The header (connect/chain/block), the flight pane (`<TxFlightList>` + per-row Speed up / Cancel), and `App.tsx` orchestrating connection, the shared source, the send path (Recipe 1), and the replacement flow — every catch routed through `viem-errors`. Not unit-tested (React + wallet); manual verification noted.

**Files:**
- Create: `examples/tx-write-flight/src/components/Header.tsx`
- Create: `examples/tx-write-flight/src/components/FlightPane.tsx`
- Modify: `examples/tx-write-flight/src/App.tsx`
- Modify: `examples/tx-write-flight/src/styles.css`

**Steps:**

- [ ] Create `examples/tx-write-flight/src/components/Header.tsx`:
  ```tsx
  import type { Hex } from 'viem'

  import { shortAddr } from '../lib/format'

  export interface HeaderProps {
    account: Hex | null
    chainLabel: string | null
    symbol: string
    blockNumber: bigint | null
    onConnect: () => void
    onDisconnect: () => void
  }

  export const Header = ({
    account,
    chainLabel,
    symbol,
    blockNumber,
    onConnect,
    onDisconnect,
  }: HeaderProps): JSX.Element => (
    <header className="app-header">
      <div className="app-header__brand">tx-write-flight</div>
      <div className="app-header__chain">
        {chainLabel ? (
          <>
            <span className="chain-name">{chainLabel}</span>
            <span className="chain-symbol">{symbol}</span>
            <span className="chain-block">
              {blockNumber !== null ? `#${blockNumber.toString()}` : '—'}
            </span>
          </>
        ) : (
          <span className="chain-name">not connected</span>
        )}
      </div>
      <div className="app-header__wallet">
        {account ? (
          <>
            <span className="wallet-addr">{shortAddr(account)}</span>
            <button type="button" onClick={onDisconnect}>Disconnect</button>
          </>
        ) : (
          <button type="button" className="primary" onClick={onConnect}>Connect wallet</button>
        )}
      </div>
    </header>
  )
  ```
- [ ] Create `examples/tx-write-flight/src/components/FlightPane.tsx`:
  ```tsx
  /**
   * Flight pane: the in-flight strip. TxFlightList renders one row per tx;
   * Speed up / Cancel are shown only while pending. The provider lives in
   * App.tsx (so the strip and the orchestration share one store).
   */
  import {
    TxFlightList,
    TxFlightItem,
    TxFlightStatusIcon,
    TxFlightHashLink,
    TxFlightAge,
    TxFlightActions,
    type TrackedTx,
  } from '@valve-tech/tx-flight-react'

  export interface FlightPaneProps {
    explorerUrl: string | null
    onSpeedUp: (tx: TrackedTx) => void
    onCancel: (tx: TrackedTx) => void
    onDismiss: (tx: TrackedTx) => void
  }

  export const FlightPane = ({
    explorerUrl,
    onSpeedUp,
    onCancel,
    onDismiss,
  }: FlightPaneProps): JSX.Element => (
    <section className="pane pane--flight">
      <h2>In flight</h2>
      <TxFlightList
        className="flight-list"
        empty={<p className="flight-empty">No transactions yet. Compose one on the left.</p>}
        render={(tx) => {
          const pending = tx.status === 'pending' || tx.status === 'awaiting-signature'
          return (
            <TxFlightItem
              key={tx.id}
              tx={tx}
              className={`flight-row flight-row--${tx.status}`}
              render={() => (
                <>
                  <TxFlightStatusIcon status={tx.status} />
                  <span className="flight-row__flow">{tx.flow ?? 'tx'}</span>
                  <span className="flight-row__status">{tx.status}</span>
                  {tx.hash && explorerUrl ? (
                    <TxFlightHashLink hash={tx.hash} explorer={explorerUrl} truncation="middle" />
                  ) : null}
                  <TxFlightAge tx={tx} />
                  <TxFlightActions
                    tx={tx}
                    onSpeedUp={pending ? onSpeedUp : undefined}
                    onCancel={pending ? onCancel : undefined}
                    onDismiss={onDismiss}
                  />
                </>
              )}
            />
          )
        }}
      />
    </section>
  )
  ```
- [ ] Verify the exact `<TxFlightList>` / `<TxFlightItem>` render-prop signatures against the installed types before relying on them: `grep -n "render\|empty\|status\|hash\|flow" node_modules/@valve-tech/tx-flight-react/dist/*.d.ts | head -40`. If `TxFlightItem`'s `render` does not accept a children-replacement callback in the installed version, fall back to the default `<TxFlightItem tx={tx} explorer={explorerUrl} />` layout and wire Speed up / Cancel via the list-level row props it exposes. Adjust the JSX above to whatever the installed `.d.ts` declares — do not invent props.
- [ ] Replace `examples/tx-write-flight/src/App.tsx` with the full orchestration:
  ```tsx
  /**
   * Top-level app. Owns: wallet connection, the per-chain shared stack
   * (ChainSource → gas-oracle + tx-tracker), the live block number, and the
   * send (Recipe 1) + replacement (speed-up / cancel) orchestration. Every
   * send/replace catch is routed through @valve-tech/viem-errors.
   *
   *   gas-oracle tier → buildTransactionRequest → addWithWalletAdapter (strip)
   *                   → sendTransactionWithHooks (injected wallet)
   *                   → tx-tracker observations advance the row
   */
  import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
  import type { Hex } from 'viem'
  import {
    TxFlightProvider,
    useTxFlight,
    type TrackedTx,
  } from '@valve-tech/tx-flight-react'
  import { localStorageAdapter } from '@valve-tech/tx-flight-react/storage'
  import {
    sendTransactionWithHooks,
    WalletRejectedError,
    ContractRevertedError,
  } from '@valve-tech/wallet-adapter'
  import {
    bumpForReplacement,
    recommendBumpTier,
    type TierName,
    type TierRecommendation,
  } from '@valve-tech/gas-oracle'
  import { replaceTransaction } from '@valve-tech/tx-tracker'
  import {
    isUserRejectionError,
    extractContractErrorName,
    getUserFriendlyErrorMessage,
  } from '@valve-tech/viem-errors'

  import { Header } from './components/Header'
  import { ComposePane } from './components/ComposePane'
  import { FlightPane } from './components/FlightPane'
  import {
    buildCancelRequest,
    buildTransactionRequest,
    type Action,
  } from './lib/actions'
  import { wethAddressFor, wethSupported } from './lib/weth'
  import { resolveChain, type ChainDisplay } from './lib/chains'
  import {
    connect as connectWallet,
    getChainId,
    getInjectedProvider,
    injectedWalletAdapter,
    injectedWalletClient,
    type Eip1193Provider,
  } from './lib/wallet'
  import {
    clientFactory,
    getChainStack,
    registerClient,
    type ChainStack,
  } from './lib/source'

  // Conservative static gas limits for the cost preview only (the wallet
  // re-estimates at sign time).
  const GAS_LIMIT_BY_KIND: Record<Action['kind'], bigint> = {
    send: 21_000n,
    wrap: 50_000n,
    unwrap: 50_000n,
  }

  interface Connection {
    provider: Eip1193Provider
    account: Hex
    display: ChainDisplay
    stack: ChainStack
  }

  /** Inner component — has access to useTxFlight (must be inside the Provider). */
  const Flight = (): JSX.Element => {
    const flight = useTxFlight()
    const [conn, setConn] = useState<Connection | null>(null)
    const [tiers, setTiers] = useState<Record<TierName, TierRecommendation> | null>(null)
    const [blockNumber, setBlockNumber] = useState<bigint | null>(null)
    const [selectedTier, setSelectedTier] = useState<TierName>('standard')
    const [busy, setBusy] = useState(false)
    const [notice, setNotice] = useState<string | null>(null)
    const [kind, setKind] = useState<Action['kind']>('send')
    // Remember each sent request by tx id, for replacement (speed-up / cancel).
    const sentRef = useRef<Map<string, { action: Action; nonce: number | null }>>(new Map())

    const connect = useCallback(async () => {
      const provider = getInjectedProvider()
      if (!provider) {
        setNotice('No injected EIP-1193 wallet found (install MetaMask / Rabby).')
        return
      }
      const account = await connectWallet(provider)
      const chainId = await getChainId(provider)
      const display = await resolveChain(chainId, '')
      const stack = getChainStack(provider, display.chain)
      registerClient(chainId, stack.client)
      setConn({ provider, account, display, stack })
    }, [])

    const disconnect = useCallback(() => {
      conn?.stack.stop()
      setConn(null)
      setTiers(null)
      setBlockNumber(null)
    }, [conn])

    // Poll oracle tiers + live block number while connected.
    useEffect(() => {
      if (!conn) return
      let alive = true
      const tick = (): void => {
        const state = conn.stack.oracle.getState()
        if (alive && state) setTiers(state.tiers)
      }
      const unsub = conn.stack.source.subscribeBlocks((block) => {
        if (alive) setBlockNumber(BigInt(block.number))
      })
      tick()
      const interval = setInterval(tick, 4_000)
      return () => {
        alive = false
        clearInterval(interval)
        unsub()
      }
    }, [conn])

    const send = useCallback(
      async (action: Action) => {
        if (!conn) return
        const { provider, account, display, stack } = conn
        const chainId = display.chain.id
        const rec = stack.oracle.getState()?.tiers[selectedTier]
        if (!rec) {
          setNotice('Gas tiers are still warming up — try again in a moment.')
          return
        }
        const request = buildTransactionRequest(action, {
          chainId,
          from: account,
          weth: wethAddressFor(chainId),
          gas: { maxFeePerGas: rec.maxFeePerGas, maxPriorityFeePerGas: rec.maxPriorityFeePerGas },
        })
        const wallet = injectedWalletAdapter(provider, account)
        const flow =
          action.kind === 'send' ? 'native-send' : action.kind === 'wrap' ? 'wrap' : 'unwrap'

        // The strip wraps the hooks: every phase fires BOTH a store update AND ours.
        const { id, hooks } = flight.addWithWalletAdapter({
          flow,
          chainId,
          request,
          hooks: {
            onTransactionHash: ({ hash }) => {
              // Record the nonce for replacement once we have a hash.
              void stack.client
                .getTransaction({ hash })
                .then((tx) =>
                  sentRef.current.set(id, { action, nonce: Number(tx.nonce) }),
                )
                .catch(() => undefined)
            },
            onFailed: ({ error }) => {
              if (isUserRejectionError(error) || error instanceof WalletRejectedError) {
                // Quiet cancel — no scary banner; let the row self-dismiss.
                setNotice(null)
                return
              }
              const decoded =
                error instanceof ContractRevertedError
                  ? extractContractErrorName(error)
                  : extractContractErrorName(error)
              setNotice(
                `${decoded ? `failed · ${decoded} — ` : ''}${getUserFriendlyErrorMessage(error)}`,
              )
            },
          },
        })
        sentRef.current.set(id, { action, nonce: null })

        setBusy(true)
        setNotice(null)
        try {
          await sendTransactionWithHooks({ wallet, request, hooks })
        } catch (error) {
          // sendTransactionWithHooks re-throws after firing onFailed; classify quietly.
          if (!(isUserRejectionError(error) || error instanceof WalletRejectedError)) {
            setNotice(getUserFriendlyErrorMessage(error))
          }
        } finally {
          setBusy(false)
        }
      },
      [conn, flight, selectedTier],
    )

    const replace = useCallback(
      async (tx: TrackedTx, mode: 'speed-up' | 'cancel') => {
        if (!conn) return
        const { provider, account, display, stack } = conn
        const sent = sentRef.current.get(tx.id)
        const state = stack.oracle.getState()
        if (!sent || sent.nonce === null || !state || !tx.request) {
          setNotice('Cannot replace yet — waiting for the nonce / gas tiers.')
          return
        }
        const walletClient = injectedWalletClient(provider, account, display.chain)
        const current = {
          maxFeePerGas: tx.request.maxFeePerGas ?? state.tiers.standard.maxFeePerGas,
          maxPriorityFeePerGas:
            tx.request.maxPriorityFeePerGas ?? state.tiers.standard.maxPriorityFeePerGas,
        }
        const bumpTier =
          recommendBumpTier(state, { priorityTip: current.maxPriorityFeePerGas }) ?? 'instant'
        const target = state.tiers[bumpTier]
        const newGas = bumpForReplacement(current, target)

        const original =
          mode === 'cancel'
            ? buildCancelRequest({ from: account, chainId: display.chain.id, nonce: sent.nonce })
            : {
                to: tx.request.to,
                data: tx.request.data,
                value: tx.request.value,
                nonce: sent.nonce,
                chainId: display.chain.id,
              }

        try {
          await replaceTransaction({ original, walletClient, newGas })
          setNotice(mode === 'cancel' ? 'Cancel submitted (same nonce).' : 'Speed-up submitted.')
        } catch (error) {
          if (isUserRejectionError(error) || error instanceof WalletRejectedError) {
            setNotice(null)
            return
          }
          setNotice(getUserFriendlyErrorMessage(error))
        }
      },
      [conn],
    )

    const tierProps = useMemo(() => tiers, [tiers])

    return (
      <>
        <Header
          account={conn?.account ?? null}
          chainLabel={conn?.display.label ?? null}
          symbol={conn?.display.symbol ?? ''}
          blockNumber={blockNumber}
          onConnect={() => void connect()}
          onDisconnect={disconnect}
        />
        {notice && <div className="notice" role="status">{notice}</div>}
        <main className="two-pane">
          <ComposePane
            connected={conn !== null}
            account={conn?.account ?? null}
            symbol={conn?.display.symbol ?? 'ETH'}
            wethSupported={conn ? wethSupported(conn.display.chain.id) : false}
            tiers={tierProps}
            selectedTier={selectedTier}
            gasLimit={GAS_LIMIT_BY_KIND[kind]}
            onSelectTier={setSelectedTier}
            onSend={(action) => {
              setKind(action.kind)
              void send(action)
            }}
            busy={busy}
          />
          <FlightPane
            explorerUrl={conn?.display.explorerUrl ?? null}
            onSpeedUp={(tx) => void replace(tx, 'speed-up')}
            onCancel={(tx) => void replace(tx, 'cancel')}
            onDismiss={(tx) => flight.remove(tx.id)}
          />
        </main>
      </>
    )
  }

  export const App = (): JSX.Element => (
    <TxFlightProvider
      id="tx-write-flight"
      storage={localStorageAdapter()}
      clientFactory={clientFactory}
    >
      <Flight />
    </TxFlightProvider>
  )
  ```
- [ ] Verify the installed `addWithWalletAdapter` / `TxFlightProvider` / `localStorageAdapter` signatures match the calls above: `grep -n "addWithWalletAdapter\|clientFactory\|localStorageAdapter\|storage" node_modules/@valve-tech/tx-flight-react/dist/*.d.ts node_modules/@valve-tech/tx-flight-react/dist/storage/*.d.ts | head -30`. Adjust prop names to the installed `.d.ts` if they differ; do not invent. (AGENTS.md documents `addWithWalletAdapter({ hooks, flow, chainId, request })` returning `{ id, hooks }`, and `<TxFlightProvider id storage maxItems terminalRetentionMs onError clientFactory>`.)
- [ ] Replace `examples/tx-write-flight/src/styles.css` with the flight-board control-panel styling:
  ```css
  :root {
    color-scheme: dark;
    --bg: #0b0e14;
    --panel: #131a26;
    --ink: #e6edf6;
    --muted: #8a97ad;
    --line: #243044;
    --accent: #4ea1ff;
    --ok: #3ad29f;
    --warn: #ffcb6b;
    --bad: #ff6b7a;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  button { font: inherit; cursor: pointer; border-radius: 8px;
    border: 1px solid var(--line); background: var(--panel); color: var(--ink); padding: 8px 12px; }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #06121f; font-weight: 600; }
  input { font: inherit; width: 100%; padding: 8px 10px; border-radius: 8px;
    border: 1px solid var(--line); background: #0e1420; color: var(--ink); }
  label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); margin-bottom: 10px; }

  .app-header { display: flex; align-items: center; justify-content: space-between;
    gap: 16px; padding: 12px 20px; border-bottom: 1px solid var(--line); }
  .app-header__brand { font-weight: 800; letter-spacing: 0.5px; }
  .app-header__chain { display: flex; gap: 10px; align-items: baseline; color: var(--muted); }
  .chain-name { color: var(--ink); font-weight: 600; }
  .chain-block { font-variant-numeric: tabular-nums; }
  .app-header__wallet { display: flex; gap: 8px; align-items: center; }

  .notice { margin: 12px 20px; padding: 10px 14px; border-radius: 8px;
    background: #1c2435; border: 1px solid var(--line); color: var(--warn); }

  .two-pane { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 20px;
    align-items: start; }
  @media (max-width: 800px) { .two-pane { grid-template-columns: 1fr; } }

  .pane { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
  .pane h2 { margin: 0 0 12px; font-size: 15px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); }

  .action-selector, .action-tab { display: inline-flex; }
  .action-selector { gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
  .action-tab--active { border-color: var(--accent); color: var(--accent); }

  .tier-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
  .tier-card { display: grid; gap: 2px; text-align: left; padding: 10px; }
  .tier-card--active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
  .tier-card__name { text-transform: capitalize; font-weight: 600; }
  .tier-card__fee { font-variant-numeric: tabular-nums; }
  .tier-card__cost { font-size: 12px; color: var(--muted); }

  .review { margin-top: 12px; padding: 12px; border: 1px dashed var(--line); border-radius: 10px; }
  .review dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 8px 0; }
  .review dt { color: var(--muted); }
  .review__actions { display: flex; gap: 8px; justify-content: flex-end; }

  .flight-list { display: grid; gap: 8px; }
  .flight-empty { color: var(--muted); }
  .flight-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
    border: 1px solid var(--line); border-radius: 10px; background: #0e1420;
    transition: border-color 200ms ease, background 200ms ease; }
  .flight-row__flow { font-weight: 600; }
  .flight-row__status { text-transform: capitalize; color: var(--muted); }
  .flight-row--confirmed { border-color: var(--ok); }
  .flight-row--failed { border-color: var(--bad); }
  .flight-row--replaced, .flight-row--dropped { border-color: var(--warn); }
  ```
- [ ] Verify typecheck: `yarn workspace @valve-tech/example-tx-write-flight run typecheck`. Expected: exits 0 (fix any prop-shape mismatches surfaced against the installed `.d.ts`).
- [ ] Verify lint: `yarn workspace @valve-tech/example-tx-write-flight run lint`. Expected: exits 0.
- [ ] **Manual verification note (no CI):** see Task 10 for the full end-to-end script.
- [ ] Commit: `git add examples/tx-write-flight/src/components/Header.tsx examples/tx-write-flight/src/components/FlightPane.tsx examples/tx-write-flight/src/App.tsx examples/tx-write-flight/src/styles.css && git commit -m "feat(examples): tx-write-flight — header, flight pane, App orchestration (Recipe 1 + replacement)"`

---

## Task 10 — README + final build gate + manual E2E

The README (what it demonstrates, wiring, run, WETH actions, caution, manual E2E), then the full build/lint/typecheck/test gate, then the documented manual run.

**Files:**
- Create: `examples/tx-write-flight/README.md`

**Steps:**

- [ ] Create `examples/tx-write-flight/README.md`:
  ```markdown
  # tx-write-flight — the write half of the evm-toolkit

  A fully static Vite + React + TS app that prices a transaction, sends it with
  lifecycle hooks, tracks it to a terminal state, renders its progress, and
  classifies failures — plus the stuck-tx replacement flow. Companion to
  `unchained-tx-history` (the read half).

  ## What it demonstrates

  - **`@valve-tech/chain-source`** — ONE poll loop, fanned out (Recipe 2).
  - **`@valve-tech/gas-oracle`** — four fee tiers + replacement-bump helpers.
  - **`@valve-tech/tx-tracker`** — per-tx state machine + same-nonce replacement.
  - **`@valve-tech/wallet-adapter`** — a thin injected EIP-1193 `WalletAdapter`
    over `window.ethereum` + `sendTransactionWithHooks`.
  - **`@valve-tech/tx-flight-react`** — the in-flight transaction strip
    (localStorage-persisted).
  - **`@valve-tech/viem-errors`** — cause-chain error classification.

  ## How the packages wire together (Recipe 1 + Recipe 2)

  ```
  createChainSource(publicClient)         # once per chain
    ├── createGasOracle({ source })       # fee tiers (cost preview)
    └── createTxTracker({ source })       # per-tx observations

  gas-oracle tier → buildTransactionRequest → useTxFlight().addWithWalletAdapter
                  → sendTransactionWithHooks (injected wallet)
                  → tx-tracker observations advance the strip row
                  → every catch → viem-errors
  ```

  ## The three actions

  | Action | Path | Notes |
  |---|---|---|
  | Native send | value transfer | works on any chain |
  | Wrap ETH → WETH | `deposit()` (payable) | contract-call happy path; needs WETH |
  | Unwrap WETH → ETH | `withdraw(amount)` | overdraw reverts → `ContractRevertedError` demo; needs WETH |

  **Which actions need WETH:** Wrap / Unwrap are gated by a chain → WETH
  registry (`src/config.ts`). On chains with no registered WETH, those two
  actions are disabled; native send still works.

  ## Run

  ```bash
  yarn install
  yarn workspace @valve-tech/example-tx-write-flight dev      # http://localhost:5173
  yarn workspace @valve-tech/example-tx-write-flight build    # static dist/
  ```

  ## ⚠️ Caution — real funds

  This app follows whatever chain your wallet is on, **mainnets included**.
  Default amounts are tiny (0.001) and a Review & send step always shows the
  resolved fee + total before signing, but transactions are real. Use a testnet
  (e.g. Sepolia) if you're just exploring.

  ## Manual end-to-end (no wallet in CI)

  1. Connect an injected wallet (MetaMask / Rabby). The header shows your
     address, chain name + native symbol, and the live block number.
  2. **Native send:** pick a recipient (defaults to self), keep the tiny amount,
     pick a tier, Review & send, confirm in the wallet. Watch the row go
     `awaiting-signature → pending → confirmed`.
  3. **Speed up / Cancel:** while a row is pending, click Speed up (bumped fee,
     same nonce) or Cancel (0-value self-send, same nonce). Watch for the
     `replaced` transition.
  4. **Wrap:** on a chain with registered WETH, wrap a tiny amount — the
     contract-call happy path.
  5. **Unwrap overdraw:** unwrap more WETH than you hold → the row shows
     `failed · <ErrorName>` from `extractContractErrorName`.
  6. **User rejection:** reject in the wallet → quiet cancel, no scary banner.
  ```
- [ ] Run the full workspace gate: `yarn workspace @valve-tech/example-tx-write-flight run test && yarn workspace @valve-tech/example-tx-write-flight run lint && yarn workspace @valve-tech/example-tx-write-flight run typecheck && yarn workspace @valve-tech/example-tx-write-flight run build`. Expected: tests pass (weth/format/actions), lint 0, typecheck 0, `vite build` writes `dist/` with no errors.
- [ ] Run the root foreach gate to confirm the example is picked up: `yarn test && yarn build`. Expected: the new workspace runs in both foreach loops with no failures.
- [ ] **Manual E2E (local, requires a browser wallet):** `yarn workspace @valve-tech/example-tx-write-flight dev`, then walk the six README steps. Confirm: one poll loop (not two), tiers populate, the strip persists across reload (localStorage), rejection is quiet, unwrap-overdraw surfaces the decoded error name.
- [ ] Commit: `git add examples/tx-write-flight/README.md && git commit -m "docs(examples): tx-write-flight — README (wiring, run, WETH actions, caution, manual E2E)"`

---

## Notes for the implementer

- **Ground every package call against the installed `.d.ts` before relying on it.** The AGENTS.md surfaces are the source of truth for names, but exact prop shapes (`addWithWalletAdapter` options, `TxFlightItem`/`TxFlightList` render props, the gas-oracle constructor's `source` vs `client` option, `pauseWhenIdle`) must be confirmed against `node_modules/@valve-tech/*/dist/*.d.ts`. Tasks 7 and 9 include explicit grep checks. **Do not invent props or function names.**
- **`tipForBlockPosition` rank is a bigint** in the installed surface (`{ kind: 'rank', rank: 10n }`) — `recommendBumpTier` uses it internally, so the app never calls it directly.
- The pure-logic tasks (2, 3, 4) are the only unit-tested code; the build is the CI gate for everything else, exactly as the spec mandates.
