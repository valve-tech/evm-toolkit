/**
 * @fileoverview The pure planner. Given what the scan found, what the
 * manifest says we previously installed, and which skill directories
 * already exist in `.claude/skills/`, decide what to do — with zero
 * I/O. The applier (`apply.ts`) executes the decisions; tests fixture
 * this file with literal inputs.
 *
 * Conservative by construction: a directory we didn't install (no
 * manifest entry) is the user's and is NEVER touched.
 */

import type { FoundSkill } from './scan.js'
import type { Manifest } from './manifest.js'

/** What the planner decided for one skill directory. */
export const SkillActionKind = {
  /** Target dir absent → copy fresh and record provenance. */
  install: 'install',
  /** Target dir exists and is ours (manifest entry) → overwrite. */
  refresh: 'refresh',
  /** Target dir exists but is NOT ours → report, never touch. */
  skipConflict: 'skip-conflict',
  /**
   * Manifest entry whose source package is no longer installed →
   * report; deleted only when the caller passes `prune`.
   */
  orphan: 'orphan',
} as const
export type SkillActionKind =
  (typeof SkillActionKind)[keyof typeof SkillActionKind]

/** One planned action. `skill` is present except for orphans. */
export interface SkillAction {
  kind: SkillActionKind
  /** The `.claude/skills/<skillDir>` directory name acted on. */
  skillDir: string
  /** Source package (from scan for install/refresh, manifest for orphan). */
  package: string
  /** The found skill (absent on orphan — its source is gone). */
  skill?: FoundSkill
  /** Whether an orphan will actually be deleted (prune mode). */
  prune?: boolean
}

/** Inputs the planner needs — all data, no handles. */
export interface PlanInput {
  found: FoundSkill[]
  manifest: Manifest
  /** Skill directory names that currently exist in `.claude/skills/`. */
  existingDirs: string[]
  /** Delete orphans instead of just reporting them. */
  prune: boolean
}

/**
 * Decide an action per found skill plus one per orphaned manifest
 * entry. Deterministic: output order is found-order, then orphans
 * sorted by directory name.
 */
export const planInstall = (input: PlanInput): SkillAction[] => {
  const existing = new Set(input.existingDirs)
  const actions: SkillAction[] = []

  for (const skill of input.found) {
    if (!existing.has(skill.skillDir)) {
      actions.push({
        kind: SkillActionKind.install,
        skillDir: skill.skillDir,
        package: skill.package,
        skill,
      })
      continue
    }
    if (skill.skillDir in input.manifest) {
      actions.push({
        kind: SkillActionKind.refresh,
        skillDir: skill.skillDir,
        package: skill.package,
        skill,
      })
      continue
    }
    actions.push({
      kind: SkillActionKind.skipConflict,
      skillDir: skill.skillDir,
      package: skill.package,
      skill,
    })
  }

  const foundDirs = new Set(input.found.map((skill) => skill.skillDir))
  const orphans = Object.keys(input.manifest)
    .filter((dir) => !foundDirs.has(dir))
    .sort()
  for (const dir of orphans) {
    actions.push({
      kind: SkillActionKind.orphan,
      skillDir: dir,
      package: input.manifest[dir].package,
      prune: input.prune,
    })
  }

  return actions
}
