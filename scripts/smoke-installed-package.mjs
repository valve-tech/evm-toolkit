#!/usr/bin/env node
// Post-publish smoke check: given the path to a freshly-installed
// @valve-tech package (inside a throwaway `npm install` tree), assert
// that every entry point its package.json advertises — `main`,
// `module`, `types`, `bin`, and every string leaf of `exports` — is a
// file that actually exists in the tarball.
//
// This catches the failure the local build cannot: an `exports` map (or
// a `files` allowlist) that references a path the published tarball
// omits, so `npm install` succeeds but the consumer's first `import`
// throws ERR_MODULE_NOT_FOUND. It deliberately does NOT execute the
// module (no peer deps needed, no side effects, works for the bin-only
// CLI package too) — existence of the advertised files is the signal.
//
// Usage: node scripts/smoke-installed-package.mjs <installed-pkg-dir>

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const pkgDir = process.argv[2];
if (!pkgDir) {
  console.error('usage: smoke-installed-package.mjs <installed-pkg-dir>');
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

// Collect every advertised entry file path (relative to the package
// root) from the fields npm/Node resolve against.
const entries = new Set();

// main/module/types/bin values and every string leaf of `exports` are
// always in-package file paths (relative, with or without a leading
// `./`). Condition names like `import`/`default` are object KEYS, which
// the exports walk never visits as values, so any string we reach here
// is a path to stat.
const addPath = (value) => {
  if (typeof value === 'string' && value.length > 0) entries.add(value);
};

for (const field of ['main', 'module', 'types']) addPath(pkg[field]);

if (typeof pkg.bin === 'string') addPath(pkg.bin);
else if (pkg.bin && typeof pkg.bin === 'object')
  for (const v of Object.values(pkg.bin)) addPath(v);

// exports can be a string, or an arbitrarily nested map of subpaths /
// condition names to strings (or `null` to block a subpath). Walk every
// string leaf.
const walkExports = (node) => {
  if (typeof node === 'string') return addPath(node);
  if (Array.isArray(node)) return node.forEach(walkExports);
  if (node && typeof node === 'object') Object.values(node).forEach(walkExports);
};
walkExports(pkg.exports);

if (entries.size === 0) {
  console.error(`✗ ${pkg.name}: package.json advertises no entry files (main/exports/bin)`);
  process.exit(1);
}

const missing = [];
for (const rel of entries) {
  if (!existsSync(resolve(pkgDir, rel))) missing.push(rel);
}

if (missing.length > 0) {
  console.error(`✗ ${pkg.name}@${pkg.version}: advertised entry files missing from the published tarball:`);
  for (const rel of missing) console.error(`    ${rel}`);
  process.exit(1);
}

console.log(`✓ ${pkg.name}@${pkg.version}: all ${entries.size} advertised entry file(s) present`);
