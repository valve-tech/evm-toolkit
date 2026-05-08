#!/usr/bin/env node
// Verify .github/workflows/release.yml has a Publish step for every
// non-private workspace under packages/. Catches the v0.9.2 class of
// bug — a new package was scaffolded but the OIDC publish workflow
// never got a step added for it, so the workflow runs green and
// silently skips that package on every release.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RELEASE_YAML = '.github/workflows/release.yml';
const PACKAGES_DIR = 'packages';

const yaml = readFileSync(RELEASE_YAML, 'utf8');
const missing = [];
let checked = 0;

for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkg = JSON.parse(
    readFileSync(join(PACKAGES_DIR, entry.name, 'package.json'), 'utf8'),
  );
  if (pkg.private) continue;
  checked++;
  if (!yaml.includes(`Publish ${pkg.name}`)) missing.push(pkg.name);
}

if (missing.length > 0) {
  console.error(`${RELEASE_YAML} is missing publish steps for:`);
  for (const name of missing) console.error(`  - ${name}`);
  console.error(
    `\nAdd a step matching the existing pattern (yarn pack + npm publish --provenance).`,
  );
  process.exit(1);
}

console.log(
  `✓ release.yml covers all ${checked} publishable workspace packages.`,
);
