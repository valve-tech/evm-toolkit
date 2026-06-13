import { describe, it, expect } from 'vitest'
import { scan, PnpDetectedError, ScanSkipReason } from './scan.js'
import { sha256 } from './fs.js'
import { createMemFs } from './testkit.js'

const pkgJson = (version: string): string => JSON.stringify({ version })

describe('scan', () => {
  it('finds skills across multiple installed @valve-tech packages', () => {
    const fs = createMemFs({
      files: {
        '/proj/package.json': pkgJson('1.0.0'),
        '/proj/node_modules/@valve-tech/gas-oracle/package.json': pkgJson('0.18.0'),
        '/proj/node_modules/@valve-tech/gas-oracle/skills/gas-oracle-integration/SKILL.md': '# gas',
        '/proj/node_modules/@valve-tech/tx-tracker/package.json': pkgJson('0.18.0'),
        '/proj/node_modules/@valve-tech/tx-tracker/skills/tx-tracker-integration/SKILL.md': '# tx',
        '/proj/node_modules/@valve-tech/tx-tracker/skills/tx-tracker-integration/extra.md': 'more',
      },
    })

    const result = scan(fs, '/proj')
    expect(result.skipped).toEqual([])
    expect(result.found.map((s) => s.skillDir).sort()).toEqual([
      'gas-oracle-integration',
      'tx-tracker-integration',
    ])

    const tx = result.found.find((s) => s.skillDir === 'tx-tracker-integration')
    expect(tx?.package).toBe('@valve-tech/tx-tracker')
    expect(tx?.version).toBe('0.18.0')
    expect(tx?.files).toEqual([
      { path: 'SKILL.md', sha256: sha256('# tx') },
      { path: 'extra.md', sha256: sha256('more') },
    ])
  })

  it('skips a package that has no skills/ directory', () => {
    const fs = createMemFs({
      files: {
        '/proj/package.json': pkgJson('1.0.0'),
        '/proj/node_modules/@valve-tech/viem-errors/package.json': pkgJson('0.18.0'),
        '/proj/node_modules/@valve-tech/viem-errors/dist/index.js': '',
      },
    })
    const result = scan(fs, '/proj')
    expect(result.found).toEqual([])
    expect(result.skipped).toEqual([
      { package: '@valve-tech/viem-errors', reason: ScanSkipReason.noSkillsDir },
    ])
  })

  it('skips a workspace-linked package (symlink resolving back into the project)', () => {
    const fs = createMemFs({
      files: {
        '/proj/package.json': pkgJson('1.0.0'),
        '/proj/packages/gas-oracle/package.json': pkgJson('0.18.0'),
        '/proj/packages/gas-oracle/skills/gas-oracle-integration/SKILL.md': '# gas',
      },
      symlinks: {
        '/proj/node_modules/@valve-tech/gas-oracle': '/proj/packages/gas-oracle',
      },
    })
    const result = scan(fs, '/proj')
    expect(result.found).toEqual([])
    expect(result.skipped).toEqual([
      { package: '@valve-tech/gas-oracle', reason: ScanSkipReason.workspaceLink },
    ])
  })

  it('ignores a skill subdirectory that lacks a SKILL.md', () => {
    const fs = createMemFs({
      files: {
        '/proj/package.json': pkgJson('1.0.0'),
        '/proj/node_modules/@valve-tech/gas-oracle/package.json': pkgJson('0.18.0'),
        '/proj/node_modules/@valve-tech/gas-oracle/skills/not-a-skill/README.md': 'x',
      },
    })
    const result = scan(fs, '/proj')
    expect(result.found).toEqual([])
  })

  it('throws PnpDetectedError when .pnp.cjs exists and node_modules does not', () => {
    const fs = createMemFs({
      files: {
        '/proj/package.json': pkgJson('1.0.0'),
        '/proj/.pnp.cjs': '/* pnp */',
      },
    })
    expect(() => scan(fs, '/proj')).toThrow(PnpDetectedError)
  })
})
