import { describe, it, expect } from 'vitest'
import { planInstall, SkillActionKind } from './plan.js'
import type { FoundSkill } from './scan.js'
import type { Manifest } from './manifest.js'

const skill = (
  skillDir: string,
  pkg: string,
  version = '0.18.0',
): FoundSkill => ({
  package: pkg,
  version,
  skillDir,
  sourcePath: `/nm/${pkg}/skills/${skillDir}`,
  files: [{ path: 'SKILL.md', sha256: 'h' }],
})

describe('planInstall', () => {
  it('installs a skill whose target dir does not yet exist', () => {
    const actions = planInstall({
      found: [skill('gas-oracle-integration', '@valve-tech/gas-oracle')],
      manifest: {},
      existingDirs: [],
      prune: false,
    })
    expect(actions).toEqual([
      expect.objectContaining({
        kind: SkillActionKind.install,
        skillDir: 'gas-oracle-integration',
        package: '@valve-tech/gas-oracle',
      }),
    ])
  })

  it('refreshes a skill that exists AND is manifest-tracked (ours)', () => {
    const manifest: Manifest = {
      'gas-oracle-integration': {
        package: '@valve-tech/gas-oracle',
        version: '0.17.0',
        files: [],
      },
    }
    const actions = planInstall({
      found: [skill('gas-oracle-integration', '@valve-tech/gas-oracle')],
      manifest,
      existingDirs: ['gas-oracle-integration'],
      prune: false,
    })
    expect(actions[0].kind).toBe(SkillActionKind.refresh)
  })

  it('reports a conflict for an existing dir we never installed', () => {
    const actions = planInstall({
      found: [skill('my-own-skill', '@valve-tech/gas-oracle')],
      manifest: {},
      existingDirs: ['my-own-skill'],
      prune: false,
    })
    expect(actions[0].kind).toBe(SkillActionKind.skipConflict)
  })

  it('reports a manifest entry whose source is gone as an orphan (no prune)', () => {
    const manifest: Manifest = {
      'old-integration': { package: '@valve-tech/old', version: '0.18.0', files: [] },
    }
    const actions = planInstall({
      found: [],
      manifest,
      existingDirs: ['old-integration'],
      prune: false,
    })
    expect(actions).toEqual([
      expect.objectContaining({
        kind: SkillActionKind.orphan,
        skillDir: 'old-integration',
        package: '@valve-tech/old',
        prune: false,
      }),
    ])
  })

  it('marks orphans with prune=true when pruning', () => {
    const manifest: Manifest = {
      'old-integration': { package: '@valve-tech/old', version: '0.18.0', files: [] },
    }
    const actions = planInstall({ found: [], manifest, existingDirs: [], prune: true })
    expect(actions[0]).toMatchObject({ kind: SkillActionKind.orphan, prune: true })
  })

  it('emits found-order actions first, then orphans sorted by dir name', () => {
    const manifest: Manifest = {
      'z-orphan': { package: '@valve-tech/z', version: '0.18.0', files: [] },
      'a-orphan': { package: '@valve-tech/a', version: '0.18.0', files: [] },
    }
    const actions = planInstall({
      found: [skill('live-integration', '@valve-tech/live')],
      manifest,
      existingDirs: [],
      prune: false,
    })
    expect(actions.map((a) => a.skillDir)).toEqual([
      'live-integration',
      'a-orphan',
      'z-orphan',
    ])
  })
})
