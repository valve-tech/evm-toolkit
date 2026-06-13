import { describe, it, expect } from 'vitest'
import { checkDrift, DriftKind } from './check.js'
import type { FoundSkill } from './scan.js'
import type { Manifest, ManifestFile } from './manifest.js'

const files = (sha: string): ManifestFile[] => [{ path: 'SKILL.md', sha256: sha }]

const found = (skillDir: string, version: string, sha: string): FoundSkill => ({
  package: '@valve-tech/gas-oracle',
  version,
  skillDir,
  sourcePath: `/nm/${skillDir}`,
  files: files(sha),
})

const manifest = (version: string, sha: string): Manifest => ({
  'gas-oracle-integration': {
    package: '@valve-tech/gas-oracle',
    version,
    files: files(sha),
  },
})

describe('checkDrift', () => {
  it('reports in-sync when version and file hashes all match', () => {
    const reports = checkDrift({
      manifest: manifest('0.18.0', 'h'),
      found: [found('gas-oracle-integration', '0.18.0', 'h')],
      installedFiles: { 'gas-oracle-integration': files('h') },
    })
    expect(reports[0].kind).toBe(DriftKind.inSync)
  })

  it('reports copy-missing when the installed dir is gone', () => {
    const reports = checkDrift({
      manifest: manifest('0.18.0', 'h'),
      found: [found('gas-oracle-integration', '0.18.0', 'h')],
      installedFiles: { 'gas-oracle-integration': null },
    })
    expect(reports[0].kind).toBe(DriftKind.copyMissing)
  })

  it('reports source-missing when the package is no longer installed', () => {
    const reports = checkDrift({
      manifest: manifest('0.18.0', 'h'),
      found: [],
      installedFiles: { 'gas-oracle-integration': files('h') },
    })
    expect(reports[0].kind).toBe(DriftKind.sourceMissing)
  })

  it('reports locally-modified when on-disk hashes differ from the manifest', () => {
    const reports = checkDrift({
      manifest: manifest('0.18.0', 'h'),
      found: [found('gas-oracle-integration', '0.18.0', 'h')],
      installedFiles: { 'gas-oracle-integration': files('EDITED') },
    })
    expect(reports[0].kind).toBe(DriftKind.locallyModified)
  })

  it('reports package-upgraded with recorded→current versions', () => {
    const reports = checkDrift({
      manifest: manifest('0.17.0', 'h'),
      found: [found('gas-oracle-integration', '0.18.0', 'h')],
      installedFiles: { 'gas-oracle-integration': files('h') },
    })
    expect(reports[0]).toMatchObject({
      kind: DriftKind.packageUpgraded,
      versions: { recorded: '0.17.0', current: '0.18.0' },
    })
  })

  it('local edits outrank an available upgrade (user must resolve first)', () => {
    const reports = checkDrift({
      manifest: manifest('0.17.0', 'h'),
      found: [found('gas-oracle-integration', '0.18.0', 'h')],
      installedFiles: { 'gas-oracle-integration': files('EDITED') },
    })
    expect(reports[0].kind).toBe(DriftKind.locallyModified)
  })
})
