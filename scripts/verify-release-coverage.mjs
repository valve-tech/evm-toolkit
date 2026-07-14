#!/usr/bin/env node
// Verify .github/workflows/release.yml publishes every non-private
// workspace under packages/. Catches the v0.9.2 class of bug — a new
// package was scaffolded but the OIDC publish workflow never got it, so
// the workflow runs green and silently skips that package on every
// release.
//
// The publish + smoke jobs both matrix over one source-of-truth package
// list emitted by the `prepare` job (`packages=[...]`, consumed via
// fromJSON). This script asserts every publishable package appears in
// that list.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RELEASE_YAML = '.github/workflows/release.yml';
const PACKAGES_DIR = 'packages';

const yaml = readFileSync(RELEASE_YAML, 'utf8');

// Extract the source-of-truth package list the `prepare` job publishes
// as a workflow output. Format (author-controlled in release.yml):
//
//     echo 'packages=["chain-source","viem-errors",...]' >> "$GITHUB_OUTPUT"
const match = yaml.match(/packages=(\[[^\]\n]*\])/);
if (!match) {
  console.error(
    `${RELEASE_YAML}: could not find the \`prepare\` job's \`packages=[...]\` list.`,
  );
  process.exit(1);
}
const listed = new Set(JSON.parse(match[1]));

const missing = [];
let checked = 0;

for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkg = JSON.parse(
    readFileSync(join(PACKAGES_DIR, entry.name, 'package.json'), 'utf8'),
  );
  if (pkg.private) continue;
  checked++;
  // Matrix entries are package DIRECTORY names (used as `cd
  // packages/<dir>`), which by repo convention match the npm name's
  // suffix.
  if (!listed.has(entry.name)) missing.push(entry.name);
}

if (missing.length > 0) {
  console.error(`${RELEASE_YAML} publish matrix is missing:`);
  for (const name of missing) console.error(`  - ${name}`);
  console.error(
    `\nAdd each to the \`matrix.package\` list in the publish job.`,
  );
  process.exit(1);
}

console.log(
  `✓ release.yml publish matrix covers all ${checked} publishable workspace packages.`,
);
