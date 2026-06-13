/**
 * @fileoverview Drift detection for `check`. Pure: compares manifest
 * entries against what the scan found and what is on disk now (the
 * caller supplies current hashes), returning per-skill verdicts.
 */

import type { FoundSkill } from './scan.js'
import type { Manifest, ManifestFile } from './manifest.js'

/** Per-skill drift verdict. */
export const DriftKind = {
  /** Installed copy matches the manifest and the source version. */
  inSync: 'in-sync',
  /** Source package version differs from the recorded one. */
  packageUpgraded: 'package-upgraded',
  /** Installed files no longer match their recorded hashes. */
  locallyModified: 'locally-modified',
  /** The recorded source package is no longer installed. */
  sourceMissing: 'source-missing',
  /** The installed copy itself is gone from `.claude/skills/`. */
  copyMissing: 'copy-missing',
} as const
export type DriftKind = (typeof DriftKind)[keyof typeof DriftKind]

/** One skill's drift report. */
export interface DriftReport {
  skillDir: string
  package: string
  kind: DriftKind
  /** Recorded → current version, when kind is `package-upgraded`. */
  versions?: { recorded: string; current: string }
}

/** Inputs for drift detection — all data, no handles. */
export interface CheckInput {
  manifest: Manifest
  found: FoundSkill[]
  /**
   * Current on-disk state of each manifest-tracked skill dir, keyed by
   * skill dir name: `null` when the dir is missing, else the file
   * list + hashes as currently on disk.
   */
  installedFiles: Record<string, ManifestFile[] | null>
}

const sameFiles = (a: ManifestFile[], b: ManifestFile[]): boolean => {
  if (a.length !== b.length) return false
  const byPath = new Map(a.map((file) => [file.path, file.sha256]))
  return b.every((file) => byPath.get(file.path) === file.sha256)
}

/**
 * Report drift for every manifest entry. Severity order when several
 * apply: missing copy > missing source > local edits > upgrade. A
 * locally-modified copy outranks the upgrade report because refresh
 * would overwrite the user's edits — that's the one the user must
 * resolve first.
 */
export const checkDrift = (input: CheckInput): DriftReport[] => {
  const foundByDir = new Map(input.found.map((skill) => [skill.skillDir, skill]))

  return Object.entries(input.manifest)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([skillDir, entry]) => {
      const onDisk = input.installedFiles[skillDir] ?? null
      if (onDisk === null) {
        return { skillDir, package: entry.package, kind: DriftKind.copyMissing }
      }
      const source = foundByDir.get(skillDir)
      if (source === undefined) {
        return { skillDir, package: entry.package, kind: DriftKind.sourceMissing }
      }
      if (!sameFiles(entry.files, onDisk)) {
        return {
          skillDir,
          package: entry.package,
          kind: DriftKind.locallyModified,
        }
      }
      if (source.version !== entry.version) {
        return {
          skillDir,
          package: entry.package,
          kind: DriftKind.packageUpgraded,
          versions: { recorded: entry.version, current: source.version },
        }
      }
      return { skillDir, package: entry.package, kind: DriftKind.inSync }
    })
}
