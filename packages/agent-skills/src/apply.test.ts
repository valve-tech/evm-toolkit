import { describe, it, expect } from 'vitest'
import { applyActions } from './apply.js'
import { SkillActionKind, type SkillAction } from './plan.js'
import { sha256 } from './fs.js'
import type { Manifest } from './manifest.js'
import { createMemFs } from './testkit.js'

const SKILLS_ROOT = '/proj/.claude/skills'

const installAction = (
  skillDir: string,
  contents: string,
  version = '0.18.0',
): SkillAction => ({
  kind: SkillActionKind.install,
  skillDir,
  package: '@valve-tech/gas-oracle',
  skill: {
    package: '@valve-tech/gas-oracle',
    version,
    skillDir,
    sourcePath: `/proj/node_modules/@valve-tech/gas-oracle/skills/${skillDir}`,
    files: [{ path: 'SKILL.md', sha256: sha256(contents) }],
  },
})

describe('applyActions', () => {
  it('copies an install and records its manifest provenance', () => {
    const action = installAction('gas-oracle-integration', '# gas')
    const fs = createMemFs({
      files: {
        [`${action.skill!.sourcePath}/SKILL.md`]: '# gas',
      },
    })
    const { outcomes, manifest } = applyActions(fs, [action], {}, SKILLS_ROOT, false)

    expect(outcomes[0]).toEqual({ action, applied: true })
    expect(fs.readFile(`${SKILLS_ROOT}/gas-oracle-integration/SKILL.md`)).toBe('# gas')
    expect(manifest['gas-oracle-integration']).toEqual({
      package: '@valve-tech/gas-oracle',
      version: '0.18.0',
      files: [{ path: 'SKILL.md', sha256: sha256('# gas') }],
    })
  })

  it('refresh wipes the old copy before writing the new one', () => {
    const action: SkillAction = {
      ...installAction('gas-oracle-integration', '# new'),
      kind: SkillActionKind.refresh,
    }
    const fs = createMemFs({
      files: {
        [`${action.skill!.sourcePath}/SKILL.md`]: '# new',
        // A stale file from a previous install that the new copy omits.
        [`${SKILLS_ROOT}/gas-oracle-integration/STALE.md`]: 'old',
        [`${SKILLS_ROOT}/gas-oracle-integration/SKILL.md`]: '# old',
      },
    })
    applyActions(fs, [action], {}, SKILLS_ROOT, false)

    expect(fs.readFile(`${SKILLS_ROOT}/gas-oracle-integration/SKILL.md`)).toBe('# new')
    expect(fs.exists(`${SKILLS_ROOT}/gas-oracle-integration/STALE.md`)).toBe(false)
  })

  it('skip-conflict writes nothing and does not touch the manifest', () => {
    const action: SkillAction = {
      kind: SkillActionKind.skipConflict,
      skillDir: 'my-own-skill',
      package: '@valve-tech/gas-oracle',
      skill: installAction('my-own-skill', 'x').skill,
    }
    const fs = createMemFs({
      files: { [`${SKILLS_ROOT}/my-own-skill/SKILL.md`]: 'mine' },
    })
    const { outcomes, manifest } = applyActions(fs, [action], {}, SKILLS_ROOT, false)

    expect(outcomes[0].applied).toBe(false)
    expect(fs.readFile(`${SKILLS_ROOT}/my-own-skill/SKILL.md`)).toBe('mine')
    expect(manifest).toEqual({})
  })

  it('orphan without prune is reported but neither deleted nor de-listed', () => {
    const prior: Manifest = {
      'old-integration': { package: '@valve-tech/old', version: '0.18.0', files: [] },
    }
    const action: SkillAction = {
      kind: SkillActionKind.orphan,
      skillDir: 'old-integration',
      package: '@valve-tech/old',
      prune: false,
    }
    const fs = createMemFs({
      files: { [`${SKILLS_ROOT}/old-integration/SKILL.md`]: 'x' },
    })
    const { outcomes, manifest } = applyActions(fs, [action], prior, SKILLS_ROOT, false)

    expect(outcomes[0].applied).toBe(false)
    expect(fs.exists(`${SKILLS_ROOT}/old-integration/SKILL.md`)).toBe(true)
    expect(manifest['old-integration']).toBeDefined()
  })

  it('orphan with prune deletes the copy and drops the manifest entry', () => {
    const prior: Manifest = {
      'old-integration': { package: '@valve-tech/old', version: '0.18.0', files: [] },
    }
    const action: SkillAction = {
      kind: SkillActionKind.orphan,
      skillDir: 'old-integration',
      package: '@valve-tech/old',
      prune: true,
    }
    const fs = createMemFs({
      files: { [`${SKILLS_ROOT}/old-integration/SKILL.md`]: 'x' },
    })
    const { manifest } = applyActions(fs, [action], prior, SKILLS_ROOT, false)

    expect(fs.exists(`${SKILLS_ROOT}/old-integration/SKILL.md`)).toBe(false)
    expect(manifest['old-integration']).toBeUndefined()
  })

  it('dry-run writes nothing but returns the would-be manifest', () => {
    const action = installAction('gas-oracle-integration', '# gas')
    const fs = createMemFs({
      files: { [`${action.skill!.sourcePath}/SKILL.md`]: '# gas' },
    })
    const { outcomes, manifest } = applyActions(fs, [action], {}, SKILLS_ROOT, true)

    expect(outcomes[0].applied).toBe(false)
    expect(fs.exists(`${SKILLS_ROOT}/gas-oracle-integration/SKILL.md`)).toBe(false)
    expect(manifest['gas-oracle-integration']).toBeDefined()
  })
})
