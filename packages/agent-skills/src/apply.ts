/**
 * @fileoverview The thin applier: executes planned actions through the
 * injected `FileSystem` and returns the updated manifest. All
 * decisions were made in `plan.ts`; nothing here branches on anything
 * but the action kind.
 */

import { joinPath, type FileSystem } from './fs.js'
import { SkillActionKind, type SkillAction } from './plan.js'
import type { Manifest } from './manifest.js'

/** Result of applying one action (for output lines). */
export interface ApplyOutcome {
  action: SkillAction
  /** False in dry-run mode — nothing was written. */
  applied: boolean
}

const copySkill = (
  fs: FileSystem,
  action: SkillAction,
  skillsRoot: string,
): void => {
  const skill = action.skill
  if (skill === undefined) return
  const target = joinPath(skillsRoot, skill.skillDir)
  fs.rm(target)
  for (const file of skill.files) {
    fs.writeFile(
      joinPath(target, file.path),
      fs.readFile(joinPath(skill.sourcePath, file.path)),
    )
  }
}

/**
 * Execute actions against `.claude/skills/` (`skillsRoot`), mutating
 * a COPY of the given manifest and returning it. With `dryRun`, no
 * filesystem writes happen and the manifest is returned updated
 * anyway (callers must not persist it — it exists for output).
 */
export const applyActions = (
  fs: FileSystem,
  actions: SkillAction[],
  manifest: Manifest,
  skillsRoot: string,
  dryRun: boolean,
): { outcomes: ApplyOutcome[]; manifest: Manifest } => {
  const next: Manifest = { ...manifest }
  const outcomes: ApplyOutcome[] = []

  for (const action of actions) {
    switch (action.kind) {
      case SkillActionKind.install:
      case SkillActionKind.refresh: {
        if (!dryRun) copySkill(fs, action, skillsRoot)
        if (action.skill !== undefined) {
          next[action.skillDir] = {
            package: action.skill.package,
            version: action.skill.version,
            files: action.skill.files,
          }
        }
        outcomes.push({ action, applied: !dryRun })
        break
      }
      case SkillActionKind.skipConflict: {
        outcomes.push({ action, applied: false })
        break
      }
      case SkillActionKind.orphan: {
        if (action.prune === true) {
          if (!dryRun) fs.rm(joinPath(skillsRoot, action.skillDir))
          delete next[action.skillDir]
          outcomes.push({ action, applied: !dryRun })
          break
        }
        outcomes.push({ action, applied: false })
        break
      }
    }
  }

  return { outcomes, manifest: next }
}
