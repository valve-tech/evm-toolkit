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

// llamaNodesRpcs.js was removed upstream (2026); extraRpcs.js no longer
// merges it and carries no imports at all.
const FILES = ['extraRpcs.js', 'chainIds.js'];

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
