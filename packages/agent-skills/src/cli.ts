#!/usr/bin/env node
/**
 * @fileoverview The `valve-agent-skills` bin. Argv parsing + output
 * formatting only — scan/plan/apply/check do the work. `runCli` is
 * exported so tests drive the full command without spawning a process.
 */

import { pathToFileURL } from 'node:url'

import { joinPath, nodeFileSystem, sha256, type FileSystem } from './fs.js'
import { scan, PnpDetectedError } from './scan.js'
import { planInstall, SkillActionKind } from './plan.js'
import { applyActions } from './apply.js'
import { checkDrift, DriftKind } from './check.js'
import {
  MANIFEST_FILENAME,
  parseManifest,
  serializeManifest,
  type ManifestFile,
} from './manifest.js'

/** Parsed command-line options. */
export interface CliOptions {
  command: 'install' | 'check'
  root: string | null
  dryRun: boolean
  prune: boolean
}

const USAGE = `Usage: valve-agent-skills <command> [options]

Commands:
  install   Copy installed @valve-tech/*/skills into .claude/skills/
  check     Report drift (upgrades, local edits, missing sources); exit 1 on drift

Options:
  --root <dir>   Project root (default: nearest package.json above cwd)
  --dry-run      install: report what would happen without writing
  --prune        install: delete orphaned skills whose source package is gone
`

/** Parse argv (post node+script). Returns null (and usage) on error. */
export const parseArgs = (argv: string[]): CliOptions | null => {
  const [command, ...rest] = argv
  if (command !== 'install' && command !== 'check') return null
  const options: CliOptions = { command, root: null, dryRun: false, prune: false }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--prune') options.prune = true
    else if (arg === '--root') {
      const value = rest[i + 1]
      if (value === undefined) return null
      options.root = value
      i += 1
    } else return null
  }
  return options
}

/** Walk up from `cwd` to the nearest directory holding package.json. */
export const findProjectRoot = (fs: FileSystem, cwd: string): string | null => {
  let dir = cwd
  for (;;) {
    if (fs.exists(joinPath(dir, 'package.json'))) return dir
    const parent = joinPath(dir, '..')
    const realParent = fs.realpath(parent)
    if (realParent === fs.realpath(dir)) return null
    dir = realParent
  }
}

const listSkillDirs = (fs: FileSystem, skillsRoot: string): string[] =>
  fs
    .listDir(skillsRoot)
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)

const hashInstalled = (
  fs: FileSystem,
  dir: string,
  prefix: string,
): ManifestFile[] =>
  fs.listDir(dir).flatMap((entry) => {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory) {
      return hashInstalled(fs, joinPath(dir, entry.name), rel)
    }
    return [{ path: rel, sha256: sha256(fs.readFile(joinPath(dir, entry.name))) }]
  })

/**
 * Run the CLI. Returns the process exit code; emits human output via
 * `log` (one line per skill + summary, per the design spec).
 */
export const runCli = (
  argv: string[],
  cwd: string,
  fs: FileSystem = nodeFileSystem,
  log: (line: string) => void = console.log,
): number => {
  const options = parseArgs(argv)
  if (options === null) {
    log(USAGE)
    return 2
  }

  const root = options.root ?? findProjectRoot(fs, cwd)
  if (root === null) {
    log('No package.json found above the current directory; pass --root.')
    return 2
  }

  const skillsRoot = joinPath(root, '.claude', 'skills')
  const manifestPath = joinPath(skillsRoot, MANIFEST_FILENAME)
  const manifest = parseManifest(
    fs.exists(manifestPath) ? fs.readFile(manifestPath) : null,
  )

  let scanned
  try {
    scanned = scan(fs, root)
  } catch (err) {
    if (err instanceof PnpDetectedError) {
      log(err.message)
      return 2
    }
    throw err
  }

  for (const skip of scanned.skipped) {
    log(`skipped    ${skip.package} (${skip.reason})`)
  }

  if (options.command === 'install') {
    const actions = planInstall({
      found: scanned.found,
      manifest,
      existingDirs: listSkillDirs(fs, skillsRoot),
      prune: options.prune,
    })
    const { outcomes, manifest: nextManifest } = applyActions(
      fs,
      actions,
      manifest,
      skillsRoot,
      options.dryRun,
    )

    for (const { action } of outcomes) {
      const dry = options.dryRun ? ' (dry-run)' : ''
      if (action.kind === SkillActionKind.install) {
        log(`installed  ${action.skillDir} ← ${action.package}${dry}`)
      } else if (action.kind === SkillActionKind.refresh) {
        log(`refreshed  ${action.skillDir} ← ${action.package}${dry}`)
      } else if (action.kind === SkillActionKind.skipConflict) {
        log(
          `conflict   ${action.skillDir} exists but was not installed by ` +
            'this tool — left untouched',
        )
      } else if (action.prune === true) {
        log(`pruned     ${action.skillDir} (source ${action.package} gone)${dry}`)
      } else {
        log(
          `orphaned   ${action.skillDir} (source ${action.package} gone — ` +
            're-run with --prune to remove)',
        )
      }
    }

    // Persist the manifest when there is something to track, or when a
    // manifest already exists (so a prune-to-empty stays in sync). A
    // pure no-op (e.g. every found skill was a conflict) creates no
    // state file.
    const shouldPersist =
      Object.keys(nextManifest).length > 0 || fs.exists(manifestPath)
    if (!options.dryRun && shouldPersist) {
      fs.writeFile(manifestPath, serializeManifest(nextManifest))
    }
    const installed = outcomes.filter(
      (outcome) =>
        outcome.action.kind === SkillActionKind.install ||
        outcome.action.kind === SkillActionKind.refresh,
    ).length
    log(`${installed} skill(s) in sync. Manifest: ${manifestPath}`)
    return 0
  }

  const installedFiles: Record<string, ManifestFile[] | null> = {}
  for (const skillDir of Object.keys(manifest)) {
    const dir = joinPath(skillsRoot, skillDir)
    installedFiles[skillDir] = fs.exists(dir)
      ? hashInstalled(fs, dir, '')
      : null
  }
  const reports = checkDrift({ manifest, found: scanned.found, installedFiles })

  let drifted = 0
  for (const report of reports) {
    if (report.kind === DriftKind.inSync) {
      log(`in-sync    ${report.skillDir}`)
      continue
    }
    drifted += 1
    const detail =
      report.kind === DriftKind.packageUpgraded && report.versions !== undefined
        ? ` (${report.versions.recorded} → ${report.versions.current} — re-run install)`
        : ''
    log(`${report.kind.padEnd(10)} ${report.skillDir} ← ${report.package}${detail}`)
  }
  log(
    drifted === 0
      ? `All ${reports.length} tracked skill(s) in sync.`
      : `${drifted} of ${reports.length} tracked skill(s) drifted.`,
  )
  return drifted === 0 ? 0 : 1
}

// Bin entry: only run when executed directly (not when imported by tests).
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  process.exit(runCli(process.argv.slice(2), process.cwd()))
}
