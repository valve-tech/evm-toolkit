# RPC Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@valve-tech/rpc-collector` — a zero-runtime-dependency package that resolves an EVM chainId to a privacy-ranked list of public RPC endpoints, and converts that list into a viem transport or ethers provider.

**Architecture:** DefiLlama's chainlist constants are **vendored** into the package as build-time-only inputs. A codegen script evaluates them with plain Node ESM and emits a committed, Node-safe `src/data.generated.ts`. Runtime code imports only that generated module, so the published package has **zero runtime dependencies**. viem and ethers adapters live behind separate subpath exports as optional peers.

**Tech Stack:** TypeScript (strict, ESM, `tsc -p .`), vitest, viem ^2 (optional peer), ethers ^6 (optional peer), Node >= 20.

## Global Constraints

- **Zero runtime dependencies.** `dependencies` in `packages/rpc-collector/package.json` MUST stay empty. DefiLlama data is vendored + code-generated, never imported at runtime.
- **Node >= 20**, `"type": "module"`, ESM only. All relative imports in `src/` MUST use explicit `.js` extensions (e.g. `./types.js`) — required by Node ESM.
- **viem `^2.0.0` and ethers `^6.0.0` are OPTIONAL peer dependencies** (`peerDependenciesMeta.*.optional = true`). Importing the root export `.` MUST NOT resolve either.
- **No silent downgrade.** Unknown chain throws `UnknownChainError`; empty endpoint list passed to an adapter throws `EmptyEndpointSetError`. Never return a dead transport.
- **Default ordering is privacy-first, never a silent filter.** `collectRpcs` returns all matching endpoints ordered `none` → `limited` → `unspecified` → `unknown` → `yes`. Callers opt into removal via `allowedTracking`.
- **Default `protocol` is `'http'`.**
- **Generated data must be deterministic** — sorted keys, no timestamps — so regeneration produces minimal diffs.
- **Run all yarn scripts from the repo root.** Per-workspace invocation breaks PATH for vitest/eslint in this repo. Targeted tests: `yarn vitest run <path>`.
- Version for the new package is `0.21.0` (matches the current synced release line). **Do not cut or publish a release.**

**Verified environment facts** (confirmed against the repo, do not re-derive):
- Root devDeps already include `viem ^2.21.0`, `ethers ^6.16.0`, `vitest ^4.1.4`, `typescript ^6.0.2`.
- `viem`'s `fallback(transports, { rank: true })` exists in viem 2.48.7.
- ethers v6 `new FallbackProvider(providers, network?, options?)`, `FallbackProviderConfig = { provider, stallTimeout?, priority?, weight? }` ("Lower priority providers are dispatched first"), `FallbackProviderOptions = { quorum?: number, ... }`.
- DefiLlama `constants/extraRpcs.js` default-exports `{ [chainId]: { rpcs: (string | {url, tracking, trackingDetails?, isOpenSource?})[] } }` and imports `../utils/fetch.js` (for `mergeDeep`) plus `./llamaNodesRpcs.js`. Its `mergeDeep` **concatenates** arrays.
- DefiLlama `constants/chainIds.js` default-exports `{ [chainIdString]: chainNameString }`.
- Dataset scale: 618 chains in extraRpcs, 302 in chainIds, 71 endpoints on chain 1 (6 bare strings + 65 objects), 3 templated `${...}` URLs across the dataset, `isOpenSource: true` present.

---

## File Structure

**Created** — all under `packages/rpc-collector/`:

| Path | Responsibility |
|---|---|
| `package.json` | Manifest: exports `.`, `./viem`, `./ethers`; optional peers; no deps |
| `tsconfig.json` | Extends repo base; `outDir: dist`, `rootDir: src` |
| `vendor/constants/extraRpcs.js` | Vendored DefiLlama RPC data (build-time only) |
| `vendor/constants/chainIds.js` | Vendored DefiLlama chainId→name map (build-time only) |
| `vendor/constants/llamaNodesRpcs.js` | Vendored DefiLlama llama-node RPCs (build-time only) |
| `vendor/utils/fetch.js` | **Ours** — minimal `mergeDeep`; satisfies the path DefiLlama's constants import |
| `vendor/README.md` | Provenance, MIT attribution, refresh instructions |
| `scripts/refresh-vendor.mjs` | Re-downloads the three DefiLlama files into `vendor/constants/` |
| `scripts/generate-data.mjs` | Evaluates vendor, normalizes, writes `src/data.generated.ts` |
| `src/data.generated.ts` | **Committed, generated.** The only data the runtime touches |
| `src/types.ts` | `Tracking`, `RpcProtocol`, `RpcEndpoint`, options types, error classes |
| `src/collect.ts` | `collectRpcs` — pure resolve/filter/order |
| `src/probe.ts` | `probeEndpoints` — opt-in async liveness/latency |
| `src/index.ts` | Root barrel (no viem/ethers imports) |
| `src/viem.ts` | `toViemTransport` |
| `src/ethers.ts` | `toEthersProvider` |
| `src/*.test.ts` | Colocated vitest suites (repo convention) |
| `README.md`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE` | Package docs |
| `skills/rpc-collector/SKILL.md` | Agent skill (ships in v1) |

**Modified:**
- `.github/workflows/release.yml:99` — add `"rpc-collector"` to the `packages=[...]` list.
- `CHANGELOG.md` (root) — `[Unreleased]` entry.

---

## Task 1: Package scaffold + vendored data + codegen

**Files:**
- Create: `packages/rpc-collector/package.json`, `packages/rpc-collector/tsconfig.json`, `packages/rpc-collector/LICENSE`
- Create: `packages/rpc-collector/vendor/utils/fetch.js`, `packages/rpc-collector/vendor/README.md`
- Create: `packages/rpc-collector/scripts/refresh-vendor.mjs`, `packages/rpc-collector/scripts/generate-data.mjs`
- Generate: `packages/rpc-collector/vendor/constants/{extraRpcs,chainIds,llamaNodesRpcs}.js`, `packages/rpc-collector/src/data.generated.ts`
- Test: `packages/rpc-collector/src/data.generated.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `src/data.generated.ts` exporting
  ```ts
  export interface RawRpcRecord { url: string; tracking: string; isOpenSource?: boolean }
  export const RPCS_BY_CHAIN_ID: Readonly<Record<string, readonly RawRpcRecord[]>>
  export const CHAIN_NAME_BY_ID: Readonly<Record<string, string>>
  export const CHAIN_ID_BY_NAME: Readonly<Record<string, string>>
  ```

- [ ] **Step 1: Create the package manifest**

Create `packages/rpc-collector/package.json`:

```json
{
  "name": "@valve-tech/rpc-collector",
  "version": "0.21.0",
  "engines": {
    "node": ">=20"
  },
  "description": "Zero-dependency EVM RPC endpoint collector. Resolves a chainId to a privacy-ranked list of public RPC endpoints sourced from the DefiLlama/chainlist dataset (vendored and code-generated, so nothing is fetched or resolved at runtime), and converts that list into a ready-to-use viem transport or ethers provider. Every endpoint carries its privacy tracking rating and open-source flag. Part of the valve-tech/evm-toolkit synchronized release line.",
  "license": "MIT",
  "homepage": "https://github.com/valve-tech/evm-toolkit/tree/main/packages/rpc-collector#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/valve-tech/evm-toolkit.git",
    "directory": "packages/rpc-collector"
  },
  "bugs": {
    "url": "https://github.com/valve-tech/evm-toolkit/issues"
  },
  "keywords": [
    "ethereum",
    "evm",
    "viem",
    "ethers",
    "rpc",
    "chainlist",
    "endpoints",
    "privacy",
    "transport",
    "provider"
  ],
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./viem": {
      "types": "./dist/viem.d.ts",
      "import": "./dist/viem.js"
    },
    "./ethers": {
      "types": "./dist/ethers.d.ts",
      "import": "./dist/ethers.js"
    }
  },
  "files": [
    "dist",
    "skills",
    "README.md",
    "AGENTS.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc -p .",
    "typecheck": "tsc -p . --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "refresh:vendor": "node scripts/refresh-vendor.mjs",
    "generate:data": "node scripts/generate-data.mjs",
    "prepare": "yarn build"
  },
  "peerDependencies": {
    "ethers": "^6.0.0",
    "viem": "^2.0.0"
  },
  "peerDependenciesMeta": {
    "ethers": {
      "optional": true
    },
    "viem": {
      "optional": true
    }
  }
}
```

- [ ] **Step 2: Create the tsconfig and copy the license**

Create `packages/rpc-collector/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

Run:
```bash
cp packages/gas-oracle/LICENSE packages/rpc-collector/LICENSE
```

- [ ] **Step 3: Write the local mergeDeep the vendored constants require**

DefiLlama's `constants/extraRpcs.js` imports `mergeDeep` from `../utils/fetch.js`. We supply our own minimal implementation rather than vendoring DefiLlama's real `utils/fetch.js`, which carries browser/network code irrelevant to codegen. **Array-concat semantics are required** — DefiLlama merges `llamaNodesRpcs` into `extraRpcs` and expects both sets of RPCs to survive.

Create `packages/rpc-collector/vendor/utils/fetch.js`:

```js
/**
 * Minimal deep-merge supplied locally because DefiLlama's `constants/`
 * modules import it from this exact path (`../utils/fetch.js`).
 *
 * We deliberately do NOT vendor DefiLlama's real utils/fetch.js — it
 * carries browser/network code that has no place in a build-time codegen
 * step. Only `mergeDeep` is needed.
 *
 * Semantics must match upstream: arrays CONCATENATE (target first), so
 * that mergeDeep(llamaNodesRpcs, extraRpcs) keeps both sets of RPCs.
 */
export function mergeDeep(target, source) {
  const isObject = (value) => value && typeof value === 'object';

  if (!isObject(target) || !isObject(source)) return source;

  const merged = { ...target };

  for (const key of Object.keys(source)) {
    const targetValue = merged[key];
    const sourceValue = source[key];

    if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      merged[key] = targetValue.concat(sourceValue);
    } else if (isObject(targetValue) && isObject(sourceValue)) {
      merged[key] = mergeDeep({ ...targetValue }, sourceValue);
    } else {
      merged[key] = sourceValue;
    }
  }

  return merged;
}
```

- [ ] **Step 4: Write the vendor refresh script**

Create `packages/rpc-collector/scripts/refresh-vendor.mjs`:

```js
#!/usr/bin/env node
// Re-download the DefiLlama/chainlist constants we vendor.
//
// These files are build-time inputs only — they are evaluated by
// scripts/generate-data.mjs to produce src/data.generated.ts, and are
// never shipped or imported at runtime.
//
// Run this, then `yarn generate:data`, to refresh the dataset.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONSTANTS_DIR = join(HERE, '..', 'vendor', 'constants');

const BASE =
  'https://raw.githubusercontent.com/DefiLlama/chainlist/refs/heads/main/constants';

const FILES = ['extraRpcs.js', 'chainIds.js', 'llamaNodesRpcs.js'];

await mkdir(CONSTANTS_DIR, { recursive: true });

for (const file of FILES) {
  const url = `${BASE}/${file}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Failed to fetch ${url}: HTTP ${response.status}`);
    process.exit(1);
  }
  const body = await response.text();
  if (body.trim().length === 0) {
    console.error(`Refused to write an empty ${file} from ${url}.`);
    process.exit(1);
  }
  await writeFile(join(CONSTANTS_DIR, file), body, 'utf8');
  console.log(`✓ ${file} (${body.length} bytes)`);
}

console.log('\nVendor refreshed. Now run: yarn generate:data');
```

- [ ] **Step 5: Fetch the vendored constants**

Run from the repo root:
```bash
node packages/rpc-collector/scripts/refresh-vendor.mjs
```
Expected: three `✓` lines (`extraRpcs.js`, `chainIds.js`, `llamaNodesRpcs.js`) then `Vendor refreshed.`

- [ ] **Step 6: Write the vendor provenance README**

Create `packages/rpc-collector/vendor/README.md`:

```markdown
# Vendored chainlist data

The files in `constants/` are copied verbatim from
[DefiLlama/chainlist](https://github.com/DefiLlama/chainlist) (MIT), the
dataset that powers chainlist.org. `utils/fetch.js` is **ours** — a minimal
`mergeDeep` that satisfies the import path those constants expect.

## These are build-time inputs only

Nothing here is published or imported at runtime. `scripts/generate-data.mjs`
evaluates these modules and emits `src/data.generated.ts`, which is the only
data the runtime touches. That keeps `@valve-tech/rpc-collector` at **zero
runtime dependencies** and avoids shipping a module graph Node's ESM loader
would have to resolve.

## Refreshing

```bash
# from the repo root
node packages/rpc-collector/scripts/refresh-vendor.mjs
node packages/rpc-collector/scripts/generate-data.mjs
yarn vitest run packages/rpc-collector
```

Commit the updated `constants/` files together with the regenerated
`src/data.generated.ts`.
```

- [ ] **Step 7: Write the codegen script**

Create `packages/rpc-collector/scripts/generate-data.mjs`:

```js
#!/usr/bin/env node
// Evaluate the vendored DefiLlama constants and emit src/data.generated.ts.
//
// The vendored modules are plain ESM data with proper .js import
// extensions, so Node can import them directly — no bundler needed.
//
// Normalization mirrors what the chainlist-rpcs wrapper does upstream:
//   - flatten { [chainId]: { rpcs: [...] } } to { [chainId]: [...] }
//   - a bare string entry becomes { url, tracking: 'unknown' }
//   - an object entry with no `tracking` becomes 'unspecified'
// We additionally DROP `trackingDetails` (multi-paragraph privacy prose
// that would dominate the shipped bundle and is not part of our API).
//
// Output is deterministic: keys sorted, no timestamp, so regeneration
// produces minimal diffs.

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'data.generated.ts');

const rawRpcs = (await import('../vendor/constants/extraRpcs.js')).default;
const rawChainIds = (await import('../vendor/constants/chainIds.js')).default;

function normalizeRecord(entry) {
  if (typeof entry === 'string') {
    return { url: entry, tracking: 'unknown' };
  }
  if (!entry || typeof entry.url !== 'string') return null;
  const record = {
    url: entry.url,
    tracking: entry.tracking || 'unspecified',
  };
  if (entry.isOpenSource === true) record.isOpenSource = true;
  return record;
}

const rpcsByChainId = {};
for (const chainId of Object.keys(rawRpcs).sort(numericThenLexical)) {
  const records = (rawRpcs[chainId]?.rpcs ?? [])
    .map(normalizeRecord)
    .filter((record) => record !== null);
  if (records.length > 0) rpcsByChainId[chainId] = records;
}

const chainNameById = {};
for (const chainId of Object.keys(rawChainIds).sort(numericThenLexical)) {
  chainNameById[chainId] = rawChainIds[chainId];
}

// name -> id. First id wins on duplicate names, matching upstream.
const chainIdByName = {};
for (const [chainId, name] of Object.entries(chainNameById)) {
  const key = name.toLowerCase();
  if (!(key in chainIdByName)) chainIdByName[key] = chainId;
}

function numericThenLexical(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

const file = `// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
//
// Source: DefiLlama/chainlist (MIT), vendored under vendor/constants/.
// Regenerate with:
//   node packages/rpc-collector/scripts/refresh-vendor.mjs
//   node packages/rpc-collector/scripts/generate-data.mjs
//
// \`trackingDetails\` is intentionally dropped — it is multi-paragraph
// privacy prose that would dominate the bundle and is not part of the
// public API.

export interface RawRpcRecord {
  readonly url: string;
  readonly tracking: string;
  readonly isOpenSource?: boolean;
}

export const RPCS_BY_CHAIN_ID: Readonly<
  Record<string, readonly RawRpcRecord[]>
> = ${JSON.stringify(rpcsByChainId, null, 2)};

export const CHAIN_NAME_BY_ID: Readonly<Record<string, string>> = ${JSON.stringify(chainNameById, null, 2)};

export const CHAIN_ID_BY_NAME: Readonly<Record<string, string>> = ${JSON.stringify(chainIdByName, null, 2)};
`;

await writeFile(OUT, file, 'utf8');

const endpointCount = Object.values(rpcsByChainId).reduce(
  (total, list) => total + list.length,
  0,
);
console.log(
  `✓ src/data.generated.ts — ${Object.keys(rpcsByChainId).length} chains, ${endpointCount} endpoints, ${Object.keys(chainNameById).length} named chains`,
);
```

- [ ] **Step 8: Generate the data module**

Run from the repo root:
```bash
node packages/rpc-collector/scripts/generate-data.mjs
```
Expected: `✓ src/data.generated.ts — 6xx chains, ~4xxx endpoints, 3xx named chains` (exact counts drift with the upstream dataset).

- [ ] **Step 9: Write the failing data-integrity test**

Create `packages/rpc-collector/src/data.generated.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  CHAIN_ID_BY_NAME,
  CHAIN_NAME_BY_ID,
  RPCS_BY_CHAIN_ID,
} from './data.generated.js';

describe('generated chainlist data', () => {
  it('includes ethereum mainnet with endpoints', () => {
    expect(RPCS_BY_CHAIN_ID['1']?.length).toBeGreaterThan(5);
  });

  it('maps mainnet id to name and back', () => {
    expect(CHAIN_NAME_BY_ID['1']).toBe('ethereum');
    expect(CHAIN_ID_BY_NAME['ethereum']).toBe('1');
  });

  it('normalizes every record to a url and a tracking value', () => {
    for (const records of Object.values(RPCS_BY_CHAIN_ID)) {
      for (const record of records) {
        expect(typeof record.url).toBe('string');
        expect(record.url.length).toBeGreaterThan(0);
        expect(typeof record.tracking).toBe('string');
        expect(record.tracking.length).toBeGreaterThan(0);
      }
    }
  });

  it('drops trackingDetails prose from the shipped data', () => {
    const mainnet = RPCS_BY_CHAIN_ID['1'] ?? [];
    for (const record of mainnet) {
      expect(record).not.toHaveProperty('trackingDetails');
    }
  });

  it('preserves the isOpenSource flag where upstream sets it', () => {
    const anyOpenSource = Object.values(RPCS_BY_CHAIN_ID)
      .flat()
      .some((record) => record.isOpenSource === true);
    expect(anyOpenSource).toBe(true);
  });

  it('keeps llamaNodes rpcs that are merged into mainnet', () => {
    const mainnet = RPCS_BY_CHAIN_ID['1'] ?? [];
    expect(mainnet.some((record) => record.url.includes('llamarpc'))).toBe(
      true,
    );
  });
});
```

- [ ] **Step 10: Run the test**

Run:
```bash
yarn vitest run packages/rpc-collector/src/data.generated.test.ts
```
Expected: PASS, 6 tests. (The data was generated in Step 8, so this suite validates the codegen rather than driving it.)

- [ ] **Step 11: Verify the package builds**

The new workspace must be linked before it can build. Run from the repo root:
```bash
yarn install
yarn build
```
Expected: `yarn install` links `@valve-tech/rpc-collector` (no lockfile churn — the package has no dependencies), then the topological build succeeds across all workspaces including the new one.

- [ ] **Step 12: Commit**

```bash
git add packages/rpc-collector
git commit -m "feat(rpc-collector): scaffold package with vendored chainlist data + codegen

DefiLlama/chainlist constants are vendored as build-time-only inputs and
evaluated by scripts/generate-data.mjs into a committed, Node-ESM-safe
src/data.generated.ts. Keeps the published package at zero runtime deps."
```

---

## Task 2: Core types and `collectRpcs`

**Files:**
- Create: `packages/rpc-collector/src/types.ts`, `packages/rpc-collector/src/collect.ts`, `packages/rpc-collector/src/index.ts`
- Test: `packages/rpc-collector/src/collect.test.ts`

**Interfaces:**
- Consumes: `RPCS_BY_CHAIN_ID`, `CHAIN_ID_BY_NAME`, `RawRpcRecord` from `./data.generated.js` (Task 1).
- Produces:
  ```ts
  type Tracking = 'none' | 'limited' | 'yes' | 'unspecified' | 'unknown'
  type RpcProtocol = 'http' | 'ws'
  interface RpcEndpoint { readonly url: string; readonly protocol: RpcProtocol; readonly tracking: Tracking; readonly isOpenSource?: boolean; readonly chainId: number }
  interface CollectRpcsOptions { chainId?: number | string; chainName?: string; allowedTracking?: readonly Tracking[]; protocol?: RpcProtocol | 'any'; openSourceOnly?: boolean; limit?: number }
  class UnknownChainError extends Error { readonly chain: string | number }
  class EmptyEndpointSetError extends Error { readonly adapter: string }
  function collectRpcs(options: CollectRpcsOptions): RpcEndpoint[]
  ```
  Tasks 3–5 import these from `./types.js`.

- [ ] **Step 1: Write the types module**

Create `packages/rpc-collector/src/types.ts`:

```ts
/** Privacy tracking rating an RPC provider self-reports upstream. */
export type Tracking =
  | 'none'
  | 'limited'
  | 'yes'
  | 'unspecified'
  | 'unknown';

/** Wire protocol an endpoint speaks. */
export type RpcProtocol = 'http' | 'ws';

/** A single public RPC endpoint for one chain. */
export interface RpcEndpoint {
  readonly url: string;
  readonly protocol: RpcProtocol;
  readonly tracking: Tracking;
  readonly isOpenSource?: boolean;
  readonly chainId: number;
}

export interface CollectRpcsOptions {
  /** Chain to look up by id. Mutually sufficient with `chainName`. */
  chainId?: number | string;
  /** Chain to look up by lowercase chainlist name, e.g. `'ethereum'`. */
  chainName?: string;
  /**
   * Restrict to these tracking ratings. Omit to get every endpoint,
   * ordered privacy-first — nothing is silently dropped.
   */
  allowedTracking?: readonly Tracking[];
  /** Wire protocol filter. Defaults to `'http'`. */
  protocol?: RpcProtocol | 'any';
  /** Keep only endpoints upstream flags as open source. */
  openSourceOnly?: boolean;
  /** Cap the number of endpoints returned, after ordering. */
  limit?: number;
}

/** Thrown when no chain in the dataset matches the requested id or name. */
export class UnknownChainError extends Error {
  readonly chain: string | number;

  constructor(chain: string | number) {
    super(
      `No chain in the chainlist dataset matches ${JSON.stringify(chain)}.`,
    );
    this.name = 'UnknownChainError';
    this.chain = chain;
  }
}

/**
 * Thrown when an adapter is handed an empty endpoint list. Building a
 * transport with no endpoints would produce a client that fails on every
 * call, so we refuse loudly instead.
 */
export class EmptyEndpointSetError extends Error {
  readonly adapter: string;

  constructor(adapter: string) {
    super(
      `${adapter} received an empty endpoint list; refusing to build a transport with no RPC endpoints.`,
    );
    this.name = 'EmptyEndpointSetError';
    this.adapter = adapter;
  }
}
```

- [ ] **Step 2: Write the failing collect tests**

Create `packages/rpc-collector/src/collect.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { collectRpcs } from './collect.js';
import { UnknownChainError, type Tracking } from './types.js';

const TRACKING_ORDER: Tracking[] = [
  'none',
  'limited',
  'unspecified',
  'unknown',
  'yes',
];

describe('collectRpcs', () => {
  it('returns http endpoints for mainnet by chainId', () => {
    const endpoints = collectRpcs({ chainId: 1 });
    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.protocol === 'http')).toBe(true);
    expect(endpoints.every((e) => e.chainId === 1)).toBe(true);
  });

  it('accepts a string chainId', () => {
    expect(collectRpcs({ chainId: '1' })).toEqual(collectRpcs({ chainId: 1 }));
  });

  it('resolves a chain by name, case-insensitively', () => {
    expect(collectRpcs({ chainName: 'Ethereum' })).toEqual(
      collectRpcs({ chainId: 1 }),
    );
  });

  it('orders endpoints privacy-first', () => {
    const endpoints = collectRpcs({ chainId: 1, protocol: 'any' });
    const ranks = endpoints.map((e) => TRACKING_ORDER.indexOf(e.tracking));
    const sorted = [...ranks].sort((a, b) => a - b);
    expect(ranks).toEqual(sorted);
  });

  it('does not silently drop tracked endpoints by default', () => {
    const all = collectRpcs({ chainId: 1, protocol: 'any' });
    expect(all.some((e) => e.tracking === 'yes')).toBe(true);
  });

  it('filters by allowedTracking when asked', () => {
    const endpoints = collectRpcs({
      chainId: 1,
      allowedTracking: ['none'],
    });
    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.tracking === 'none')).toBe(true);
  });

  it('strips endpoints with unresolved template placeholders', () => {
    for (const chainId of [1, 56, 8453]) {
      const endpoints = collectRpcs({ chainId, protocol: 'any' });
      expect(endpoints.every((e) => !e.url.includes('${'))).toBe(true);
    }
  });

  it('returns only websocket endpoints when asked', () => {
    const endpoints = collectRpcs({ chainId: 1, protocol: 'ws' });
    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.protocol === 'ws')).toBe(true);
  });

  it('honours openSourceOnly', () => {
    const endpoints = collectRpcs({ chainId: 1, openSourceOnly: true });
    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.isOpenSource === true)).toBe(true);
  });

  it('applies limit after ordering', () => {
    const all = collectRpcs({ chainId: 1 });
    const limited = collectRpcs({ chainId: 1, limit: 3 });
    expect(limited).toEqual(all.slice(0, 3));
  });

  it('deduplicates repeated urls', () => {
    const urls = collectRpcs({ chainId: 1, protocol: 'any' }).map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('throws UnknownChainError for an id that is not in the dataset', () => {
    expect(() => collectRpcs({ chainId: 99999999999 })).toThrow(
      UnknownChainError,
    );
  });

  it('throws UnknownChainError for an unknown chain name', () => {
    expect(() => collectRpcs({ chainName: 'not-a-real-chain' })).toThrow(
      UnknownChainError,
    );
  });

  it('throws a TypeError when neither chainId nor chainName is given', () => {
    expect(() => collectRpcs({})).toThrow(TypeError);
  });

  it('returns an empty array when filters exclude everything', () => {
    const endpoints = collectRpcs({
      chainId: 1,
      allowedTracking: [],
    });
    expect(endpoints).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:
```bash
yarn vitest run packages/rpc-collector/src/collect.test.ts
```
Expected: FAIL — `Failed to load .../collect.js` (the module does not exist yet).

- [ ] **Step 4: Implement `collectRpcs`**

Create `packages/rpc-collector/src/collect.ts`:

```ts
import {
  CHAIN_ID_BY_NAME,
  RPCS_BY_CHAIN_ID,
  type RawRpcRecord,
} from './data.generated.js';
import {
  UnknownChainError,
  type CollectRpcsOptions,
  type RpcEndpoint,
  type RpcProtocol,
  type Tracking,
} from './types.js';

/** Lower rank sorts first. Privacy-respecting endpoints lead. */
const TRACKING_RANK: Record<Tracking, number> = {
  none: 0,
  limited: 1,
  unspecified: 2,
  unknown: 3,
  yes: 4,
};

const KNOWN_TRACKING = new Set<string>(Object.keys(TRACKING_RANK));

function toTracking(value: string): Tracking {
  return KNOWN_TRACKING.has(value) ? (value as Tracking) : 'unknown';
}

function toProtocol(url: string): RpcProtocol | null {
  if (url.startsWith('wss://') || url.startsWith('ws://')) return 'ws';
  if (url.startsWith('https://') || url.startsWith('http://')) return 'http';
  return null;
}

function resolveChainId(options: CollectRpcsOptions): string {
  const { chainId, chainName } = options;

  if (chainId !== undefined && chainId !== null) {
    const key = String(chainId);
    if (!(key in RPCS_BY_CHAIN_ID)) throw new UnknownChainError(chainId);
    return key;
  }

  if (chainName) {
    const key = CHAIN_ID_BY_NAME[chainName.toLowerCase()];
    if (key === undefined || !(key in RPCS_BY_CHAIN_ID)) {
      throw new UnknownChainError(chainName);
    }
    return key;
  }

  throw new TypeError(
    'collectRpcs requires either a `chainId` or a `chainName`.',
  );
}

function toEndpoint(
  record: RawRpcRecord,
  chainId: number,
): RpcEndpoint | null {
  // Upstream ships a handful of templated urls (e.g. `${INFURA_API_KEY}`)
  // that are unusable without a key. Drop them rather than hand back an
  // endpoint that cannot connect.
  if (record.url.includes('${')) return null;

  const protocol = toProtocol(record.url);
  if (protocol === null) return null;

  return {
    url: record.url,
    protocol,
    tracking: toTracking(record.tracking),
    ...(record.isOpenSource === true ? { isOpenSource: true } : {}),
    chainId,
  };
}

/**
 * Resolve a chain to its public RPC endpoints, ordered privacy-first.
 *
 * Pure and synchronous — the dataset is compiled into the package, so no
 * network access happens here. Nothing is filtered out unless you ask:
 * by default every endpoint for the chain is returned, ordered so the
 * least-tracking providers come first.
 *
 * @throws {UnknownChainError} if the chain is not in the dataset.
 * @throws {TypeError} if neither `chainId` nor `chainName` is supplied.
 */
export function collectRpcs(options: CollectRpcsOptions): RpcEndpoint[] {
  const {
    allowedTracking,
    protocol = 'http',
    openSourceOnly = false,
    limit,
  } = options;

  const chainKey = resolveChainId(options);
  const chainId = Number(chainKey);
  const records = RPCS_BY_CHAIN_ID[chainKey] ?? [];

  const seen = new Set<string>();
  const endpoints: RpcEndpoint[] = [];

  for (const record of records) {
    const endpoint = toEndpoint(record, chainId);
    if (endpoint === null) continue;
    if (protocol !== 'any' && endpoint.protocol !== protocol) continue;
    if (openSourceOnly && endpoint.isOpenSource !== true) continue;
    if (allowedTracking && !allowedTracking.includes(endpoint.tracking)) {
      continue;
    }
    if (seen.has(endpoint.url)) continue;
    seen.add(endpoint.url);
    endpoints.push(endpoint);
  }

  // Stable sort: equal-ranked endpoints keep their upstream order.
  endpoints.sort((a, b) => {
    const byTracking = TRACKING_RANK[a.tracking] - TRACKING_RANK[b.tracking];
    if (byTracking !== 0) return byTracking;

    const byOpenSource =
      Number(b.isOpenSource === true) - Number(a.isOpenSource === true);
    if (byOpenSource !== 0) return byOpenSource;

    // Prefer http over ws when both are in play.
    if (a.protocol !== b.protocol) return a.protocol === 'http' ? -1 : 1;

    return 0;
  });

  return typeof limit === 'number' ? endpoints.slice(0, limit) : endpoints;
}
```

- [ ] **Step 5: Write the root barrel**

Create `packages/rpc-collector/src/index.ts`:

```ts
export { collectRpcs } from './collect.js';
export {
  EmptyEndpointSetError,
  UnknownChainError,
  type CollectRpcsOptions,
  type RpcEndpoint,
  type RpcProtocol,
  type Tracking,
} from './types.js';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:
```bash
yarn vitest run packages/rpc-collector/src/collect.test.ts
```
Expected: PASS, 15 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/rpc-collector/src
git commit -m "feat(rpc-collector): add collectRpcs with privacy-first ordering

Pure, synchronous resolution of a chainId or chain name to its public RPC
endpoints. Returns everything by default, ordered none -> limited ->
unspecified -> unknown -> yes; callers opt into removal via allowedTracking.
Strips templated urls, dedupes, throws UnknownChainError on a miss."
```

---

## Task 3: Optional async probe

**Files:**
- Create: `packages/rpc-collector/src/probe.ts`
- Modify: `packages/rpc-collector/src/index.ts`
- Test: `packages/rpc-collector/src/probe.test.ts`

**Interfaces:**
- Consumes: `RpcEndpoint` from `./types.js` (Task 2).
- Produces:
  ```ts
  interface ProbedRpcEndpoint extends RpcEndpoint { readonly latencyMs: number | null; readonly alive: boolean }
  interface ProbeOptions { timeoutMs?: number; keepDead?: boolean }
  function probeEndpoints(endpoints: readonly RpcEndpoint[], options?: ProbeOptions): Promise<ProbedRpcEndpoint[]>
  ```

- [ ] **Step 1: Write the failing probe tests**

Create `packages/rpc-collector/src/probe.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeEndpoints } from './probe.js';
import type { RpcEndpoint } from './types.js';

function endpoint(url: string, protocol: 'http' | 'ws' = 'http'): RpcEndpoint {
  return { url, protocol, tracking: 'none', chainId: 1 };
}

/** Resolve a JSON-RPC chainId reply after `delayMs`. */
function replyWithChainId(hexChainId: string, delayMs: number) {
  return () =>
    new Promise((resolve) => {
      setTimeout(
        () =>
          resolve({
            ok: true,
            json: async () => ({ jsonrpc: '2.0', id: 1, result: hexChainId }),
          }),
        delayMs,
      );
    });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('probeEndpoints', () => {
  it('orders live endpoints by latency', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(replyWithChainId('0x1', 50))
      .mockImplementationOnce(replyWithChainId('0x1', 5));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeEndpoints([
      endpoint('https://slow.example'),
      endpoint('https://fast.example'),
    ]);

    expect(result.map((e) => e.url)).toEqual([
      'https://fast.example',
      'https://slow.example',
    ]);
    expect(result.every((e) => e.alive)).toBe(true);
    expect(result[0]?.latencyMs).not.toBeNull();
  });

  it('drops endpoints that fail to respond', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')))
      .mockImplementationOnce(replyWithChainId('0x1', 1));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeEndpoints([
      endpoint('https://dead.example'),
      endpoint('https://live.example'),
    ]);

    expect(result.map((e) => e.url)).toEqual(['https://live.example']);
  });

  it('drops endpoints that report the wrong chainId', async () => {
    const fetchMock = vi.fn().mockImplementation(replyWithChainId('0x89', 1));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeEndpoints([endpoint('https://wrong.example')]);

    expect(result).toEqual([]);
  });

  it('keeps dead endpoints, flagged, when keepDead is set', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeEndpoints([endpoint('https://dead.example')], {
      keepDead: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.alive).toBe(false);
    expect(result[0]?.latencyMs).toBeNull();
  });

  it('passes websocket endpoints through unprobed, after measured ones', async () => {
    const fetchMock = vi.fn().mockImplementation(replyWithChainId('0x1', 1));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeEndpoints([
      endpoint('wss://ws.example', 'ws'),
      endpoint('https://http.example'),
    ]);

    expect(result.map((e) => e.url)).toEqual([
      'https://http.example',
      'wss://ws.example',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result[1]?.latencyMs).toBeNull();
    expect(result[1]?.alive).toBe(true);
  });

  it('returns an empty array for an empty input', async () => {
    await expect(probeEndpoints([])).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
yarn vitest run packages/rpc-collector/src/probe.test.ts
```
Expected: FAIL — cannot resolve `./probe.js`.

- [ ] **Step 3: Implement the probe**

Create `packages/rpc-collector/src/probe.ts`:

```ts
import type { RpcEndpoint } from './types.js';

export interface ProbedRpcEndpoint extends RpcEndpoint {
  /** Round-trip time in ms, or null if not measured (websocket). */
  readonly latencyMs: number | null;
  /** False only when the endpoint was probed and failed. */
  readonly alive: boolean;
}

export interface ProbeOptions {
  /** Per-endpoint timeout. Defaults to 3000ms. */
  timeoutMs?: number;
  /** Keep failed endpoints in the result, flagged `alive: false`. */
  keepDead?: boolean;
}

const DEFAULT_TIMEOUT_MS = 3_000;

async function probeOne(
  endpoint: RpcEndpoint,
  timeoutMs: number,
): Promise<ProbedRpcEndpoint> {
  // Websockets cannot be probed with fetch. Rather than declare them dead
  // on no evidence, pass them through unmeasured.
  if (endpoint.protocol === 'ws') {
    return { ...endpoint, latencyMs: null, alive: true };
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: [],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) return { ...endpoint, latencyMs: null, alive: false };

    const payload = (await response.json()) as { result?: unknown };
    if (typeof payload.result !== 'string') {
      return { ...endpoint, latencyMs: null, alive: false };
    }

    // An endpoint answering for the wrong chain is misconfigured, not
    // healthy — treat it as dead rather than quietly returning it.
    if (Number(payload.result) !== endpoint.chainId) {
      return { ...endpoint, latencyMs: null, alive: false };
    }

    return { ...endpoint, latencyMs: Date.now() - startedAt, alive: true };
  } catch {
    return { ...endpoint, latencyMs: null, alive: false };
  }
}

/**
 * Ping each endpoint and reorder by measured latency.
 *
 * Opt-in and network-bound — the rest of this package is pure. Dead
 * endpoints are dropped unless `keepDead` is set. Websocket endpoints are
 * not probed; they are kept, unmeasured, and sorted after measured ones.
 */
export async function probeEndpoints(
  endpoints: readonly RpcEndpoint[],
  options: ProbeOptions = {},
): Promise<ProbedRpcEndpoint[]> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, keepDead = false } = options;

  const probed = await Promise.all(
    endpoints.map((endpoint) => probeOne(endpoint, timeoutMs)),
  );

  const kept = keepDead ? probed : probed.filter((e) => e.alive);

  return kept.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.latencyMs === b.latencyMs) return 0;
    if (a.latencyMs === null) return 1;
    if (b.latencyMs === null) return -1;
    return a.latencyMs - b.latencyMs;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
yarn vitest run packages/rpc-collector/src/probe.test.ts
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Export the probe from the barrel**

Replace the contents of `packages/rpc-collector/src/index.ts`:

```ts
export { collectRpcs } from './collect.js';
export {
  probeEndpoints,
  type ProbedRpcEndpoint,
  type ProbeOptions,
} from './probe.js';
export {
  EmptyEndpointSetError,
  UnknownChainError,
  type CollectRpcsOptions,
  type RpcEndpoint,
  type RpcProtocol,
  type Tracking,
} from './types.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/rpc-collector/src
git commit -m "feat(rpc-collector): add opt-in probeEndpoints

Pings endpoints with eth_chainId, drops those that fail or answer for the
wrong chain, and reorders survivors by latency. Websockets pass through
unmeasured rather than being declared dead on no evidence."
```

---

## Task 4: viem adapter

**Files:**
- Create: `packages/rpc-collector/src/viem.ts`
- Test: `packages/rpc-collector/src/viem.test.ts`

**Interfaces:**
- Consumes: `RpcEndpoint`, `EmptyEndpointSetError` from `./types.js` (Task 2).
- Produces:
  ```ts
  type TransportMode = 'fallback' | 'loadBalance'
  interface ToViemTransportOptions { mode?: TransportMode }
  function toViemTransport(endpoints: readonly RpcEndpoint[], options?: ToViemTransportOptions): FallbackTransport
  ```

- [ ] **Step 1: Write the failing viem adapter tests**

Create `packages/rpc-collector/src/viem.test.ts`:

**Note on testing `rank`:** viem does not expose the `rank` option on the
transport it returns — internally it only triggers `rankTransports`, which
starts a polling interval. So the mode tests spy on viem's `fallback` and
assert the config this adapter passes to it. That is precisely this adapter's
contract: translate `mode` into viem's config. Do **not** invoke the returned
transport in the `loadBalance` test — invoking it is what starts the ranking
interval, which would leak a timer into the suite.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Keep viem's real implementation but make `fallback` a spy, so the mode
// tests can assert the exact config this adapter hands to viem.
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return { ...actual, fallback: vi.fn(actual.fallback) };
});

import { fallback } from 'viem';

import { EmptyEndpointSetError, type RpcEndpoint } from './types.js';
import { toViemTransport } from './viem.js';

function endpoint(url: string, protocol: 'http' | 'ws' = 'http'): RpcEndpoint {
  return { url, protocol, tracking: 'none', chainId: 1 };
}

beforeEach(() => {
  vi.mocked(fallback).mockClear();
});

describe('toViemTransport', () => {
  it('builds a fallback transport over every endpoint', () => {
    const transport = toViemTransport([
      endpoint('https://a.example'),
      endpoint('https://b.example'),
    ]);

    const { config, value } = transport({});
    expect(config.type).toBe('fallback');
    expect(value?.transports).toHaveLength(2);
  });

  it('preserves endpoint order in the transport', () => {
    const transport = toViemTransport([
      endpoint('https://first.example'),
      endpoint('https://second.example'),
    ]);

    const urls = transport({}).value?.transports.map((t) => t.value?.url);
    expect(urls).toEqual(['https://first.example', 'https://second.example']);
  });

  it('does not enable ranking in fallback mode', () => {
    toViemTransport([endpoint('https://a.example')], { mode: 'fallback' });
    expect(vi.mocked(fallback).mock.calls[0]?.[1]).toBeUndefined();
  });

  it('defaults to fallback mode', () => {
    toViemTransport([endpoint('https://a.example')]);
    expect(vi.mocked(fallback).mock.calls[0]?.[1]).toBeUndefined();
  });

  it('enables ranking in loadBalance mode', () => {
    toViemTransport([endpoint('https://a.example')], { mode: 'loadBalance' });
    expect(vi.mocked(fallback).mock.calls[0]?.[1]).toEqual({ rank: true });
  });

  it('uses a websocket transport for ws endpoints', () => {
    const transport = toViemTransport([endpoint('wss://a.example', 'ws')]);
    const { value } = transport({});
    expect(value?.transports[0]?.config.type).toBe('webSocket');
  });

  it('throws EmptyEndpointSetError on an empty list', () => {
    expect(() => toViemTransport([])).toThrow(EmptyEndpointSetError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
yarn vitest run packages/rpc-collector/src/viem.test.ts
```
Expected: FAIL — cannot resolve `./viem.js`.

- [ ] **Step 3: Implement the viem adapter**

Create `packages/rpc-collector/src/viem.ts`:

```ts
import { fallback, http, webSocket, type FallbackTransport } from 'viem';

import { EmptyEndpointSetError, type RpcEndpoint } from './types.js';

export type TransportMode = 'fallback' | 'loadBalance';

export interface ToViemTransportOptions {
  /**
   * `'fallback'` (default) tries endpoints in order and rotates on
   * failure. `'loadBalance'` lets viem ping and re-rank them by latency,
   * steering traffic toward the fastest live endpoints.
   */
  mode?: TransportMode;
}

/**
 * Build a viem transport from collected endpoints.
 *
 * @throws {EmptyEndpointSetError} if `endpoints` is empty.
 */
export function toViemTransport(
  endpoints: readonly RpcEndpoint[],
  options: ToViemTransportOptions = {},
): FallbackTransport {
  const { mode = 'fallback' } = options;

  if (endpoints.length === 0) {
    throw new EmptyEndpointSetError('toViemTransport');
  }

  const transports = endpoints.map((endpoint) =>
    endpoint.protocol === 'ws' ? webSocket(endpoint.url) : http(endpoint.url),
  );

  return mode === 'loadBalance'
    ? fallback(transports, { rank: true })
    : fallback(transports);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
yarn vitest run packages/rpc-collector/src/viem.test.ts
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/rpc-collector/src
git commit -m "feat(rpc-collector): add viem transport adapter

toViemTransport builds a viem fallback transport from collected endpoints;
loadBalance mode enables viem's latency ranker. Refuses an empty endpoint
list rather than returning a transport that fails every call."
```

---

## Task 5: ethers adapter

**Files:**
- Create: `packages/rpc-collector/src/ethers.ts`
- Test: `packages/rpc-collector/src/ethers.test.ts`

**Interfaces:**
- Consumes: `RpcEndpoint`, `EmptyEndpointSetError` from `./types.js` (Task 2); `TransportMode` from `./viem.js` is NOT reused (that module imports viem) — `ethers.ts` declares its own identical union so the two entry points stay independent.
- Produces:
  ```ts
  type EthersTransportMode = 'fallback' | 'loadBalance'
  interface ToEthersProviderOptions { mode?: EthersTransportMode }
  function toEthersProvider(endpoints: readonly RpcEndpoint[], options?: ToEthersProviderOptions): FallbackProvider
  ```

- [ ] **Step 1: Write the failing ethers adapter tests**

Create `packages/rpc-collector/src/ethers.test.ts`:

```ts
import { FallbackProvider } from 'ethers';
import { describe, expect, it } from 'vitest';

import { toEthersProvider } from './ethers.js';
import { EmptyEndpointSetError, type RpcEndpoint } from './types.js';

function endpoint(url: string, protocol: 'http' | 'ws' = 'http'): RpcEndpoint {
  return { url, protocol, tracking: 'none', chainId: 1 };
}

describe('toEthersProvider', () => {
  it('builds a FallbackProvider over every endpoint', () => {
    const provider = toEthersProvider([
      endpoint('https://a.example'),
      endpoint('https://b.example'),
    ]);

    expect(provider).toBeInstanceOf(FallbackProvider);
    expect(provider.providerConfigs).toHaveLength(2);
  });

  it('assigns ascending priority in fallback mode', () => {
    const provider = toEthersProvider(
      [endpoint('https://a.example'), endpoint('https://b.example')],
      { mode: 'fallback' },
    );

    const priorities = provider.providerConfigs.map((c) => c.priority);
    expect(priorities).toEqual([1, 2]);
  });

  it('assigns equal priority in loadBalance mode', () => {
    const provider = toEthersProvider(
      [endpoint('https://a.example'), endpoint('https://b.example')],
      { mode: 'loadBalance' },
    );

    const priorities = provider.providerConfigs.map((c) => c.priority);
    expect(priorities).toEqual([1, 1]);
  });

  it('uses quorum 1 so a single endpoint can answer', () => {
    const provider = toEthersProvider([
      endpoint('https://a.example'),
      endpoint('https://b.example'),
    ]);
    expect(provider.quorum).toBe(1);
  });

  it('throws EmptyEndpointSetError on an empty list', () => {
    expect(() => toEthersProvider([])).toThrow(EmptyEndpointSetError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
yarn vitest run packages/rpc-collector/src/ethers.test.ts
```
Expected: FAIL — cannot resolve `./ethers.js`.

- [ ] **Step 3: Implement the ethers adapter**

Create `packages/rpc-collector/src/ethers.ts`:

```ts
import {
  FallbackProvider,
  JsonRpcProvider,
  WebSocketProvider,
  type FallbackProviderConfig,
} from 'ethers';

import { EmptyEndpointSetError, type RpcEndpoint } from './types.js';

export type EthersTransportMode = 'fallback' | 'loadBalance';

export interface ToEthersProviderOptions {
  /**
   * `'fallback'` (default) dispatches in list order — ethers sends to the
   * lowest priority number first. `'loadBalance'` gives every endpoint
   * equal priority so ethers spreads requests across them.
   */
  mode?: EthersTransportMode;
}

/**
 * Build an ethers `FallbackProvider` from collected endpoints.
 *
 * Quorum is pinned to 1: we want failover and load spreading, not
 * multi-provider consensus, which would multiply every request.
 *
 * @throws {EmptyEndpointSetError} if `endpoints` is empty.
 */
export function toEthersProvider(
  endpoints: readonly RpcEndpoint[],
  options: ToEthersProviderOptions = {},
): FallbackProvider {
  const { mode = 'fallback' } = options;

  if (endpoints.length === 0) {
    throw new EmptyEndpointSetError('toEthersProvider');
  }

  const configs: FallbackProviderConfig[] = endpoints.map(
    (endpoint, index) => ({
      provider:
        endpoint.protocol === 'ws'
          ? new WebSocketProvider(endpoint.url)
          : new JsonRpcProvider(endpoint.url),
      priority: mode === 'loadBalance' ? 1 : index + 1,
      weight: 1,
    }),
  );

  return new FallbackProvider(configs, undefined, { quorum: 1 });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
yarn vitest run packages/rpc-collector/src/ethers.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the root export pulls in neither peer**

Run:
```bash
node -e "
const src = require('fs').readFileSync('packages/rpc-collector/src/index.ts','utf8');
if (/from '(viem|ethers)'/.test(src)) { console.error('FAIL: root barrel imports a peer'); process.exit(1); }
console.log('OK: root barrel imports no peer dependency');
"
```
Expected: `OK: root barrel imports no peer dependency`

- [ ] **Step 6: Commit**

```bash
git add packages/rpc-collector/src
git commit -m "feat(rpc-collector): add ethers provider adapter

toEthersProvider builds a FallbackProvider with quorum 1 — ascending
priority for failover, equal priority to spread load. Kept in its own
entry point so the root export resolves neither optional peer."
```

---

## Task 6: Docs, agent skill, and release wiring

**Files:**
- Create: `packages/rpc-collector/README.md`, `packages/rpc-collector/AGENTS.md`, `packages/rpc-collector/CHANGELOG.md`
- Create: `packages/rpc-collector/skills/rpc-collector/SKILL.md`
- Modify: `.github/workflows/release.yml:99`
- Modify: `CHANGELOG.md` (root)

**Interfaces:**
- Consumes: the full public API from Tasks 2–5.
- Produces: a release-ready package that `yarn verify:clean` and `yarn verify:release-coverage` both accept.

- [ ] **Step 1: Add the package to the release publish matrix**

In `.github/workflows/release.yml`, line 99, append `"rpc-collector"` to the list so it reads:

```yaml
          echo 'packages=["chain-source","viem-errors","wallet-adapter","gas-oracle","tx-tracker","tx-flight-react","trueblocks-sdk","wallet-key-session","siwe-store","wallet-crypto","agent-skills","unchained-reader","rpc-collector"]' >> "$GITHUB_OUTPUT"
```

- [ ] **Step 2: Verify the release-coverage gate passes**

Run:
```bash
yarn verify:release-coverage
```
Expected: `✓ release.yml publish matrix covers all 13 publishable workspace packages.`

- [ ] **Step 3: Write the package README**

Create `packages/rpc-collector/README.md`:

````markdown
# @valve-tech/rpc-collector

Zero-dependency EVM RPC endpoint collector. Resolve a chainId to a
privacy-ranked list of public RPC endpoints, then hand that list straight to
viem or ethers.

## Why this exists

Picking a public RPC usually means hardcoding a URL and hoping it stays up.
This package turns that into data: every endpoint the chainlist dataset knows
about, ordered so the providers that track you least come first, ready to be
wired into a transport with failover.

The dataset is **compiled into the package** at build time from
[DefiLlama/chainlist](https://github.com/DefiLlama/chainlist), so there are no
runtime dependencies and no network calls during collection.

## Install

```bash
yarn add @valve-tech/rpc-collector
# plus whichever client you use
yarn add viem   # or: yarn add ethers
```

## Quick start

```ts
import { collectRpcs } from '@valve-tech/rpc-collector'

// Every mainnet HTTP endpoint, least-tracking first.
const endpoints = collectRpcs({ chainId: 1 })

console.log(endpoints[0])
// { url: 'https://eth.llamarpc.com', protocol: 'http',
//   tracking: 'none', isOpenSource: true, chainId: 1 }
```

### With viem

```ts
import { createPublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { collectRpcs } from '@valve-tech/rpc-collector'
import { toViemTransport } from '@valve-tech/rpc-collector/viem'

const endpoints = collectRpcs({ chainId: 1, allowedTracking: ['none'], limit: 5 })

const client = createPublicClient({
  chain: mainnet,
  transport: toViemTransport(endpoints, { mode: 'loadBalance' }),
})
```

### With ethers

```ts
import { collectRpcs } from '@valve-tech/rpc-collector'
import { toEthersProvider } from '@valve-tech/rpc-collector/ethers'

const provider = toEthersProvider(
  collectRpcs({ chainId: 1, limit: 5 }),
  { mode: 'fallback' },
)
```

## Privacy ordering

Endpoints are returned **in full** and ordered by the provider's self-reported
tracking rating — nothing is silently dropped:

`none` → `limited` → `unspecified` → `unknown` → `yes`

Opt into hard filtering when you want it:

```ts
collectRpcs({ chainId: 1, allowedTracking: ['none', 'limited'] })
collectRpcs({ chainId: 1, openSourceOnly: true })
```

## API

```ts
collectRpcs(options: CollectRpcsOptions): RpcEndpoint[]
```

| Option | Default | Meaning |
|---|---|---|
| `chainId` | — | Chain to look up by id (number or string) |
| `chainName` | — | Chain to look up by name, e.g. `'ethereum'` (case-insensitive) |
| `allowedTracking` | all | Restrict to these tracking ratings |
| `protocol` | `'http'` | `'http'`, `'ws'`, or `'any'` |
| `openSourceOnly` | `false` | Keep only endpoints flagged open source |
| `limit` | — | Cap the result, applied after ordering |

Throws `UnknownChainError` if the chain is not in the dataset, and `TypeError`
if neither `chainId` nor `chainName` is supplied.

```ts
probeEndpoints(endpoints, { timeoutMs?, keepDead? }): Promise<ProbedRpcEndpoint[]>
```

Opt-in liveness check. Pings each HTTP endpoint with `eth_chainId`, drops any
that fail or answer for the wrong chain, and reorders survivors by latency.
Websocket endpoints pass through unmeasured.

```ts
toViemTransport(endpoints, { mode?: 'fallback' | 'loadBalance' }): FallbackTransport
toEthersProvider(endpoints, { mode?: 'fallback' | 'loadBalance' }): FallbackProvider
```

`'fallback'` tries endpoints in order and rotates on failure. `'loadBalance'`
spreads traffic — viem re-ranks by latency, ethers gives every endpoint equal
priority. Both throw `EmptyEndpointSetError` rather than return a transport
that would fail every call.

## Refreshing the dataset

```bash
node packages/rpc-collector/scripts/refresh-vendor.mjs
node packages/rpc-collector/scripts/generate-data.mjs
```

See [`vendor/README.md`](./vendor/README.md).

## License

MIT
````

- [ ] **Step 4: Write AGENTS.md**

Create `packages/rpc-collector/AGENTS.md`:

```markdown
# @valve-tech/rpc-collector — notes for agents

## Invariants

1. **Zero runtime dependencies.** `dependencies` stays empty. The chainlist
   dataset is vendored under `vendor/` as a build-time input and compiled to
   `src/data.generated.ts`. Never add a runtime import of `vendor/`.
2. **`src/data.generated.ts` is generated.** Do not hand-edit it. Regenerate
   with `scripts/refresh-vendor.mjs` then `scripts/generate-data.mjs`, and
   commit both the vendored constants and the regenerated file together.
3. **The root export must not import viem or ethers.** They are optional peers
   reachable only through the `./viem` and `./ethers` subpath exports. A root
   import would break consumers who installed neither.
4. **Never silently drop endpoints.** `collectRpcs` returns everything for the
   chain, ordered privacy-first. Removal happens only when the caller passes
   `allowedTracking` / `openSourceOnly` / `protocol`.
5. **Adapters refuse empty input.** Throw `EmptyEndpointSetError` rather than
   build a transport with no endpoints.

## Why the data is vendored rather than depended on

The obvious dependency, `chainlist-rpcs`, is `type: module` but uses
extensionless relative imports (`from './modules/rpcs'`). Node's native ESM
loader rejects those, so it resolves only inside a bundler. Depending on it
would pass CI (vitest bundles through Vite) and then crash real Node consumers
with `ERR_MODULE_NOT_FOUND`. Vendoring DefiLlama's constants — which do use
proper `.js` extensions — and compiling them to a plain data module avoids the
whole class of problem and drops the runtime dependency entirely.

`vendor/utils/fetch.js` is ours, not DefiLlama's: their constants import
`mergeDeep` from that path, and their real `utils/fetch.js` carries
browser/network code we do not want. Its array-**concat** semantics matter —
`mergeDeep(llamaNodesRpcs, extraRpcs)` must keep both sets of RPCs.
```

- [ ] **Step 5: Write the package CHANGELOG**

Create `packages/rpc-collector/CHANGELOG.md`:

```markdown
# Changelog

All notable changes to `@valve-tech/rpc-collector` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release. `collectRpcs` resolves a chainId or chain name to its
  public RPC endpoints from the vendored DefiLlama/chainlist dataset,
  ordered privacy-first (`none` → `limited` → `unspecified` → `unknown` →
  `yes`) with no silent filtering.
- `toViemTransport` (`@valve-tech/rpc-collector/viem`) and
  `toEthersProvider` (`@valve-tech/rpc-collector/ethers`) build a viem
  fallback transport or an ethers `FallbackProvider` from collected
  endpoints, in `fallback` or `loadBalance` mode.
- `probeEndpoints` opt-in liveness and latency check.
- Zero runtime dependencies — the dataset is compiled into the package at
  build time; viem and ethers are optional peers.
```

- [ ] **Step 6: Add the root CHANGELOG entry**

In the root `CHANGELOG.md`, under the `[Unreleased]` heading's `### Added`
section (create the section if the heading has none), add:

```markdown
- **`@valve-tech/rpc-collector`** (new package) — resolves a chainId to a
  privacy-ranked list of public RPC endpoints from a vendored
  DefiLlama/chainlist dataset, and converts them into a viem transport or
  ethers provider. Zero runtime dependencies.
```

- [ ] **Step 7: Write the agent skill**

Create `packages/rpc-collector/skills/rpc-collector/SKILL.md`:

```markdown
---
name: rpc-collector
description: Use when choosing, discovering, or wiring public EVM RPC endpoints — finding RPCs for a chainId, filtering them by privacy tracking, or building a viem transport / ethers provider with failover instead of hardcoding a single RPC URL. Covers @valve-tech/rpc-collector's collectRpcs, probeEndpoints, toViemTransport, and toEthersProvider.
---

# Collecting EVM RPC endpoints

`@valve-tech/rpc-collector` turns "which RPC should I use?" into data. It ships
the DefiLlama/chainlist dataset compiled into the package — no runtime
dependencies, no network call to discover endpoints.

## Get endpoints for a chain

```ts
import { collectRpcs } from '@valve-tech/rpc-collector'

const endpoints = collectRpcs({ chainId: 1 })
```

Results are ordered privacy-first: `none` → `limited` → `unspecified` →
`unknown` → `yes`. **Nothing is filtered out by default** — a tracked endpoint
is still returned, just last. Filter explicitly when it matters:

```ts
collectRpcs({ chainId: 1, allowedTracking: ['none'], limit: 5 })
collectRpcs({ chainId: 1, openSourceOnly: true })
collectRpcs({ chainName: 'base', protocol: 'ws' })
```

`protocol` defaults to `'http'`. Use `'ws'` or `'any'` when you need sockets.

Unknown chains throw `UnknownChainError` — they never come back as an empty
array, so a typo cannot look like "this chain has no RPCs".

## Wire it into a client

Adapters live in subpath exports so the core never pulls a peer dependency.

```ts
import { toViemTransport } from '@valve-tech/rpc-collector/viem'

const transport = toViemTransport(endpoints, { mode: 'loadBalance' })
```

```ts
import { toEthersProvider } from '@valve-tech/rpc-collector/ethers'

const provider = toEthersProvider(endpoints, { mode: 'fallback' })
```

- `'fallback'` — try in order, rotate on failure.
- `'loadBalance'` — spread traffic; viem re-ranks by latency, ethers gives
  every endpoint equal priority.

Both throw `EmptyEndpointSetError` on an empty list rather than hand back a
transport that fails every call. If you filtered aggressively, check the array
is non-empty first.

## Check liveness before committing

```ts
import { probeEndpoints } from '@valve-tech/rpc-collector'

const live = await probeEndpoints(endpoints, { timeoutMs: 2000 })
```

This is the only part of the package that touches the network. It drops
endpoints that fail or answer for the wrong chainId, and sorts by latency.
With viem you usually do not need it — `mode: 'loadBalance'` already ranks.

## Common mistakes

- **Assuming the default filters out trackers.** It does not; it orders them
  last. Pass `allowedTracking` if you need a hard filter.
- **Importing an adapter from the root export.** `toViemTransport` is at
  `@valve-tech/rpc-collector/viem`, not the package root.
- **Editing `src/data.generated.ts`.** It is generated; re-run the vendor
  refresh and codegen scripts instead.
```

- [ ] **Step 8: Run the full verification gate**

Run:
```bash
yarn verify:clean && yarn verify:release-coverage
```
Expected: build, lint, typecheck, example typecheck, all tests, persisted-types
check, and the release-coverage gate all pass. The rpc-collector suites
(data.generated, collect, probe, viem, ethers) appear in the test output.

- [ ] **Step 9: Regenerate the API docs**

Run:
```bash
yarn docs:build
```
Expected: docs regenerate, including a `rpc-collector` entry.

- [ ] **Step 10: Commit**

```bash
git add packages/rpc-collector .github/workflows/release.yml CHANGELOG.md docs
git commit -m "docs(rpc-collector): README, AGENTS, changelog, skill, release wiring

Adds rpc-collector to the release publish matrix so verify:release-coverage
covers all 13 packages, and ships the agent skill alongside the docs."
```

---

## Post-plan: handing off to a release

The package is **release-ready, not released.** Per CLAUDE.md the maintainer
triggers releases. When one is cut, the `releasing-evm-toolkit` skill applies,
with two new-package specifics:

- `@valve-tech/rpc-collector` has never been published, so it needs the
  **manual first publish** before OIDC trusted publishing can take over.
- Promote the package CHANGELOG's `[Unreleased]` block into the release
  version heading — new packages are the ones most often left behind.

---

## Self-Review

**Spec coverage** — every section of `2026-07-21-rpc-collector-design.md` maps
to a task:

| Spec section | Task |
|---|---|
| Data layer (zero-runtime) | 1 |
| Collect + filter, `RpcEndpoint` type | 2 |
| Adapters — viem | 4 |
| Adapters — ethers | 5 |
| Optional probe | 3 |
| Error handling (`UnknownChainError`, `EmptyEndpointSetError`) | 2, 4, 5 |
| Testing | every task (TDD steps) |
| Package & release wiring | 1, 6 |
| Resolved decision 1 — privacy-first, no silent drop | 2 (test: "does not silently drop tracked endpoints by default") |
| Resolved decision 2 — default `protocol: 'http'` | 2 |
| Resolved decision 3 — skills ship in v1 | 6 |

**Deviation from the spec, deliberately:** the spec named `chainlist-rpcs` as a
pinned runtime dependency. Implementation research proved that package
unusable at runtime under Node ESM (extensionless imports → `ERR_MODULE_NOT_FOUND`),
so this plan vendors DefiLlama's constants and code-generates the data instead.
The user approved this change. Net effect is strictly better: zero runtime
dependencies rather than one. The spec's "Why `chainlist-rpcs`" section is now
historical context; `AGENTS.md` records the reasoning.

**Type consistency** — `RpcEndpoint`, `Tracking`, `RpcProtocol`,
`UnknownChainError`, `EmptyEndpointSetError` are defined once in Task 2's
`src/types.ts` and imported by Tasks 3, 4, and 5 under those exact names.
`RawRpcRecord` / `RPCS_BY_CHAIN_ID` / `CHAIN_ID_BY_NAME` / `CHAIN_NAME_BY_ID`
are produced by Task 1's codegen and consumed with those exact names in Task 2.
`TransportMode` (viem) and `EthersTransportMode` (ethers) are intentionally
separate declarations so neither entry point imports the other's peer.

**Placeholder scan** — no TBD/TODO; every code step carries complete code and
every test step an exact command with expected output.
