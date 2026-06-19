#!/usr/bin/env node
/**
 * Generate per-package API docs (HTML + JSON) using TypeDoc, plus
 * vendor the upstream OpenAPI spec for @valve-tech/trueblocks-sdk.
 *
 * Run via:    yarn docs:build
 * CI check:   yarn docs:check (uses --check)
 *
 * Outputs land under docs/api/<package-name>/ (HTML) and
 * docs/api/<package-name>.json (TypeDoc JSON model). The JSON model is
 * the artifact consumer docs sites (e.g. docs.valve.city) ingest.
 *
 * Why per-package (not a single TypeDoc run): TypeDoc's `packages`
 * entryPointStrategy concatenates output under one project; we want
 * each package's docs to be addressable as a standalone artifact.
 */
import { mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const ROOT = resolve(import.meta.dirname, '..')
const DOCS_DIR = join(ROOT, 'docs', 'api')
const PACKAGES_DIR = join(ROOT, 'packages')

// Upstream chifra OpenAPI spec — pinned at the same SHA used by
// scripts/codegen.mjs in @valve-tech/trueblocks-sdk so the two stay
// coherent. If the SDK's pinned SHA changes, update this constant
// in the same commit.
const TRUEBLOCKS_CORE_SHA = '3205a003af599adf2229408f74afbe6952391883'
const TRUEBLOCKS_OPENAPI_URL =
  `https://raw.githubusercontent.com/TrueBlocks/trueblocks-core/${TRUEBLOCKS_CORE_SHA}/docs/content/api/openapi.yaml`

const CHECK_MODE = process.argv.includes('--check')

const log = (msg) => console.log(`[docs] ${msg}`)
const warn = (msg) => console.warn(`[docs] ${msg}`)

const sha256 = async (path) => {
  const buf = await readFile(path)
  return createHash('sha256').update(buf).digest('hex')
}

const dirHashRecursive = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  const h = createHash('sha256')
  for (const entry of entries) {
    const full = join(dir, entry.name)
    h.update(entry.name)
    if (entry.isDirectory()) {
      h.update(await dirHashRecursive(full))
    } else {
      h.update(await sha256(full))
    }
  }
  return h.digest('hex')
}

const discoverPackages = async () => {
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true })
  const pkgs = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const pkgJsonPath = join(PACKAGES_DIR, entry.name, 'package.json')
    if (!existsSync(pkgJsonPath)) continue
    const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'))
    if (pkgJson.private) continue
    const entryPath = join(PACKAGES_DIR, entry.name, 'src', 'index.ts')
    if (!existsSync(entryPath)) continue
    pkgs.push({
      slug: entry.name,                       // directory name
      name: pkgJson.name,                     // @valve-tech/<name>
      version: pkgJson.version,
      description: pkgJson.description ?? '',
      dir: join(PACKAGES_DIR, entry.name),
      entry: join(PACKAGES_DIR, entry.name, 'src', 'index.ts'),
      tsconfig: join(PACKAGES_DIR, entry.name, 'tsconfig.json'),
    })
  }
  pkgs.sort((a, b) => a.slug.localeCompare(b.slug))
  return pkgs
}

const runTypedoc = (pkg, outDir, jsonPath) => {
  const args = [
    'typedoc',
    '--options', join(ROOT, 'typedoc.base.json'),
    '--tsconfig', pkg.tsconfig,
    '--out', outDir,
    '--json', jsonPath,
    '--name', `${pkg.name} v${pkg.version}`,
    // Codegen-derived files bloat the JSON model with thousands of
    // pass-through type aliases. trueblocks-sdk specifically ships
    // a `generated.ts` from the upstream OpenAPI codegen; the
    // vendored openapi.yaml is the better source-of-truth for those
    // types. Pattern is global so it's a no-op for packages without
    // a generated.ts.
    '--exclude', '**/generated.ts',
    pkg.entry,
  ]
  const result = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`TypeDoc failed for ${pkg.name} (exit ${result.status})`)
  }
}

const stripVolatileFromJson = async (jsonPath) => {
  // TypeDoc embeds its own version + a generation timestamp into the
  // JSON. Strip those so `docs:check` can do a stable diff in CI.
  const data = JSON.parse(await readFile(jsonPath, 'utf8'))
  const stripped = {
    ...data,
    typeDocJsonSchemaVersion: undefined,
    typeDocVersion: undefined,
    generated: undefined,
  }
  await writeFile(jsonPath, JSON.stringify(stripped, null, 2) + '\n')
}

const stripVolatileFromHtml = async (htmlDir) => {
  // TypeDoc's HTML index.html contains a generation timestamp. We
  // patch it out so the HTML output is byte-stable for `docs:check`.
  // Recurse all *.html files.
  const entries = await readdir(htmlDir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(htmlDir, entry.name)
    if (entry.isDirectory()) {
      await stripVolatileFromHtml(full)
    } else if (entry.name.endsWith('.html')) {
      const buf = await readFile(full, 'utf8')
      const stripped = buf
        .replace(/<meta[^>]*name="generator"[^>]*content="[^"]*"[^>]*>/g, '')
        .replace(/Generated using TypeDoc[^<]*/g, 'Generated using TypeDoc')
      if (stripped !== buf) await writeFile(full, stripped)
    }
  }
}

const fetchUpstreamOpenapi = async () => {
  const dest = join(DOCS_DIR, 'trueblocks-openapi.yaml')
  log(`fetching upstream chifra OpenAPI @ ${TRUEBLOCKS_CORE_SHA}`)
  const res = await fetch(TRUEBLOCKS_OPENAPI_URL)
  if (!res.ok) {
    throw new Error(`Failed to fetch upstream OpenAPI: ${res.status} ${res.statusText}`)
  }
  const body = await res.text()
  await writeFile(dest, body)
  return dest
}

const main = async () => {
  const pkgs = await discoverPackages()
  log(`discovered ${pkgs.length} packages`)

  if (CHECK_MODE) {
    // Snapshot the existing docs/api/ tree, regenerate into a temp
    // location, diff. Used as a CI gate to ensure committed docs
    // are up-to-date with source.
    const tmpRoot = join(ROOT, '.docs-check-tmp')
    await rm(tmpRoot, { recursive: true, force: true })
    await mkdir(tmpRoot, { recursive: true })
    for (const pkg of pkgs) {
      const outDir = join(tmpRoot, pkg.slug)
      const jsonPath = join(tmpRoot, `${pkg.slug}.json`)
      runTypedoc(pkg, outDir, jsonPath)
      await stripVolatileFromJson(jsonPath)
      await stripVolatileFromHtml(outDir)
    }
    // Compare just the JSON outputs (HTML is volatile across TypeDoc
    // releases due to bundled assets and minor template tweaks; the
    // JSON is the contract for downstream consumers).
    let drifted = []
    for (const pkg of pkgs) {
      const committed = join(DOCS_DIR, `${pkg.slug}.json`)
      const fresh = join(tmpRoot, `${pkg.slug}.json`)
      if (!existsSync(committed)) {
        drifted.push(`${pkg.slug}: docs/api/${pkg.slug}.json missing`)
        continue
      }
      const ch = await sha256(committed)
      const fh = await sha256(fresh)
      if (ch !== fh) drifted.push(`${pkg.slug}: docs/api/${pkg.slug}.json out of date`)
    }
    await rm(tmpRoot, { recursive: true, force: true })
    if (drifted.length > 0) {
      console.error('✗ Docs are out of date:')
      for (const d of drifted) console.error(`  - ${d}`)
      console.error('  Run `yarn docs:build` to regenerate, then commit the result.')
      process.exit(1)
    }
    console.log('✓ docs/api/*.json all match source')
    return
  }

  // Preserve hand-curated files (README, schema docs, etc.). We
  // only purge the generated artifacts: per-package HTML dirs +
  // per-package JSON files + the manifest + the vendored upstream
  // OpenAPI yaml. Anything else in docs/api/ is treated as
  // hand-curated and left alone.
  if (existsSync(DOCS_DIR)) {
    const existing = await readdir(DOCS_DIR, { withFileTypes: true })
    for (const entry of existing) {
      const full = join(DOCS_DIR, entry.name)
      const isGeneratedHtmlDir = entry.isDirectory() // per-package HTML output
      const isGeneratedJson = entry.isFile() && entry.name.endsWith('.json')
      const isVendoredOpenapi = entry.name === 'trueblocks-openapi.yaml'
      if (isGeneratedHtmlDir || isGeneratedJson || isVendoredOpenapi) {
        await rm(full, { recursive: true, force: true })
      }
    }
  } else {
    await mkdir(DOCS_DIR, { recursive: true })
  }

  for (const pkg of pkgs) {
    log(`building ${pkg.name}`)
    const outDir = join(DOCS_DIR, pkg.slug)
    const jsonPath = join(DOCS_DIR, `${pkg.slug}.json`)
    runTypedoc(pkg, outDir, jsonPath)
    await stripVolatileFromJson(jsonPath)
    await stripVolatileFromHtml(outDir)
  }

  // Vendor the upstream chifra OpenAPI spec for trueblocks-sdk.
  try {
    await fetchUpstreamOpenapi()
    log('vendored trueblocks-openapi.yaml')
  } catch (err) {
    warn(`could not fetch upstream OpenAPI: ${err.message}`)
    warn('Continuing without it — re-run yarn docs:build when network is available.')
  }

  // Manifest summarizing every package's artifacts. docs.valve.city
  // can read this single file to discover what's available rather
  // than listing the directory.
  const manifest = {
    schemaVersion: 1,
    generatedFor: 'docs.valve.city ingestion',
    repository: 'valve-tech/evm-toolkit',
    packages: pkgs.map((p) => ({
      name: p.name,
      slug: p.slug,
      version: p.version,
      description: p.description,
      html: `${p.slug}/index.html`,
      json: `${p.slug}.json`,
      ...(p.slug === 'trueblocks-sdk'
        ? { openapi: 'trueblocks-openapi.yaml' }
        : {}),
    })),
  }
  await writeFile(
    join(DOCS_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  )
  log('wrote docs/api/manifest.json')
  log('done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
