/**
 * @fileoverview Discover installed `@valve-tech/*` skills. Walks
 * `node_modules/@valve-tech/<pkg>/skills/<skill>/` in a consumer
 * project and returns what it finds — no writes, no decisions (the
 * planner decides; see `plan.ts`).
 */

import { joinPath, sha256, type FileSystem } from './fs.js'
import type { ManifestFile } from './manifest.js'

/** One skill directory found inside an installed package. */
export interface FoundSkill {
  /** Source npm package name, e.g. `@valve-tech/gas-oracle`. */
  package: string
  /** The package's installed version (from its package.json). */
  version: string
  /** The skill directory name, e.g. `gas-oracle-integration`. */
  skillDir: string
  /** Absolute path of the skill directory inside node_modules. */
  sourcePath: string
  /** Files under the skill dir (relative paths + content hashes). */
  files: ManifestFile[]
}

/** Why a package was skipped during the scan. */
export const ScanSkipReason = {
  /**
   * The node_modules entry is a symlink resolving INSIDE the project
   * (a workspace link) — this is the toolkit monorepo itself or a
   * linked checkout, not a consumer install. Installing would copy a
   * skill into the very repo that authors it.
   */
  workspaceLink: 'workspace-link',
  /** Package has no `skills/` directory. */
  noSkillsDir: 'no-skills-dir',
} as const
export type ScanSkipReason =
  (typeof ScanSkipReason)[keyof typeof ScanSkipReason]

/** A package the scan looked at but took no skills from. */
export interface ScanSkip {
  package: string
  reason: ScanSkipReason
}

/** Everything the scan learned. */
export interface ScanResult {
  found: FoundSkill[]
  skipped: ScanSkip[]
}

/** Thrown when the project uses yarn PnP — there is no node_modules. */
export class PnpDetectedError extends Error {
  constructor() {
    super(
      "This project uses yarn Plug'n'Play (.pnp.cjs present, no " +
        'node_modules). The installer reads skills out of node_modules ' +
        'and cannot run here — read them in place instead: each ' +
        '@valve-tech package ships its skills in the npm tarball.',
    )
    this.name = 'PnpDetectedError'
  }
}

const SCOPE = '@valve-tech'

const isInside = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(parent + '/')

const collectFiles = (
  fs: FileSystem,
  dir: string,
  prefix: string,
): ManifestFile[] =>
  fs.listDir(dir).flatMap((entry) => {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory) {
      return collectFiles(fs, joinPath(dir, entry.name), rel)
    }
    return [{ path: rel, sha256: sha256(fs.readFile(joinPath(dir, entry.name))) }]
  })

/**
 * Scan a project root for installed `@valve-tech/*` skills.
 *
 * @throws PnpDetectedError when `.pnp.cjs` exists and `node_modules`
 *   does not — yarn PnP projects have no tree to scan.
 */
export const scan = (fs: FileSystem, projectRoot: string): ScanResult => {
  const nodeModules = joinPath(projectRoot, 'node_modules')
  if (!fs.exists(nodeModules) && fs.exists(joinPath(projectRoot, '.pnp.cjs'))) {
    throw new PnpDetectedError()
  }

  const scopeDir = joinPath(nodeModules, SCOPE)
  const found: FoundSkill[] = []
  const skipped: ScanSkip[] = []

  for (const entry of fs.listDir(scopeDir)) {
    if (!entry.isDirectory) continue
    const pkgName = `${SCOPE}/${entry.name}`
    const pkgDir = joinPath(scopeDir, entry.name)

    const real = fs.realpath(pkgDir)
    const insideNodeModules = isInside(real, fs.realpath(nodeModules))
    if (!insideNodeModules && isInside(real, fs.realpath(projectRoot))) {
      skipped.push({ package: pkgName, reason: ScanSkipReason.workspaceLink })
      continue
    }

    const skillsDir = joinPath(pkgDir, 'skills')
    if (!fs.exists(skillsDir)) {
      skipped.push({ package: pkgName, reason: ScanSkipReason.noSkillsDir })
      continue
    }

    const pkgJson = JSON.parse(
      fs.readFile(joinPath(pkgDir, 'package.json')),
    ) as { version?: string }
    const version = pkgJson.version ?? '0.0.0'

    for (const skillEntry of fs.listDir(skillsDir)) {
      if (!skillEntry.isDirectory) continue
      const sourcePath = joinPath(skillsDir, skillEntry.name)
      if (!fs.exists(joinPath(sourcePath, 'SKILL.md'))) continue
      found.push({
        package: pkgName,
        version,
        skillDir: skillEntry.name,
        sourcePath,
        files: collectFiles(fs, sourcePath, ''),
      })
    }
  }

  return { found, skipped }
}
