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
