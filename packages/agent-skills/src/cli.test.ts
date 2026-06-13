import { describe, it, expect } from 'vitest'
import { runCli, parseArgs, findProjectRoot } from './cli.js'
import { MANIFEST_FILENAME, parseManifest } from './manifest.js'
import { createMemFs, type MemFs } from './testkit.js'

const MANIFEST_PATH = `/proj/.claude/skills/${MANIFEST_FILENAME}`

/** A consumer project with one installed @valve-tech package + skill. */
const consumerProject = (version = '0.18.0'): MemFs =>
  createMemFs({
    files: {
      '/proj/package.json': JSON.stringify({ name: 'consumer', version: '1.0.0' }),
      '/proj/node_modules/@valve-tech/gas-oracle/package.json': JSON.stringify({ version }),
      '/proj/node_modules/@valve-tech/gas-oracle/skills/gas-oracle-integration/SKILL.md':
        '# gas-oracle integration',
    },
  })

const run = (fs: MemFs, argv: string[]): { code: number; out: string } => {
  const lines: string[] = []
  const code = runCli(argv, '/proj', fs, (line) => lines.push(line))
  return { code, out: lines.join('\n') }
}

describe('parseArgs', () => {
  it('rejects an unknown command', () => {
    expect(parseArgs(['frobnicate'])).toBeNull()
  })

  it('rejects --root without a value', () => {
    expect(parseArgs(['install', '--root'])).toBeNull()
  })

  it('parses flags and --root value', () => {
    expect(parseArgs(['install', '--dry-run', '--prune', '--root', '/x'])).toEqual({
      command: 'install',
      root: '/x',
      dryRun: true,
      prune: true,
    })
  })
})

describe('findProjectRoot', () => {
  it('walks up to the nearest package.json', () => {
    const fs = createMemFs({ files: { '/a/package.json': '{}' } })
    expect(findProjectRoot(fs, '/a/b/c')).toBe('/a')
  })

  it('returns null when no package.json is found up to the root', () => {
    const fs = createMemFs({ files: { '/a/b/file.txt': 'x' } })
    expect(findProjectRoot(fs, '/a/b')).toBeNull()
  })
})

describe('runCli install', () => {
  it('populates .claude/skills and writes a provenance manifest (exit 0)', () => {
    const fs = consumerProject()
    const { code, out } = run(fs, ['install'])

    expect(code).toBe(0)
    expect(out).toContain('installed  gas-oracle-integration')
    expect(fs.readFile('/proj/.claude/skills/gas-oracle-integration/SKILL.md')).toBe(
      '# gas-oracle integration',
    )
    const manifest = parseManifest(fs.readFile(MANIFEST_PATH))
    expect(manifest['gas-oracle-integration'].package).toBe('@valve-tech/gas-oracle')
    expect(manifest['gas-oracle-integration'].version).toBe('0.18.0')
  })

  it('is idempotent — re-running refreshes in place with no surprises', () => {
    const fs = consumerProject()
    run(fs, ['install'])
    const { code, out } = run(fs, ['install'])

    expect(code).toBe(0)
    expect(out).toContain('refreshed  gas-oracle-integration')
    expect(fs.readFile('/proj/.claude/skills/gas-oracle-integration/SKILL.md')).toBe(
      '# gas-oracle integration',
    )
  })

  it('leaves a pre-existing, unmanaged skill dir untouched (conflict)', () => {
    const fs = consumerProject()
    fs.writeFile('/proj/.claude/skills/gas-oracle-integration/SKILL.md', 'MY OWN VERSION')
    const { code, out } = run(fs, ['install'])

    expect(code).toBe(0)
    expect(out).toContain('conflict   gas-oracle-integration')
    expect(fs.readFile('/proj/.claude/skills/gas-oracle-integration/SKILL.md')).toBe(
      'MY OWN VERSION',
    )
    expect(fs.exists(MANIFEST_PATH)).toBe(false)
  })

  it('--dry-run writes nothing', () => {
    const fs = consumerProject()
    const { code, out } = run(fs, ['install', '--dry-run'])

    expect(code).toBe(0)
    expect(out).toContain('(dry-run)')
    expect(fs.exists('/proj/.claude/skills/gas-oracle-integration/SKILL.md')).toBe(false)
    expect(fs.exists(MANIFEST_PATH)).toBe(false)
  })

  it('exits 2 with guidance on a yarn PnP project', () => {
    const fs = createMemFs({
      files: {
        '/proj/package.json': '{}',
        '/proj/.pnp.cjs': '/* pnp */',
      },
    })
    const { code, out } = run(fs, ['install'])
    expect(code).toBe(2)
    expect(out).toContain("Plug'n'Play")
  })

  it('--prune removes an orphaned skill whose source package is gone', () => {
    const fs = consumerProject()
    run(fs, ['install'])
    // Source package uninstalled: drop it from node_modules.
    fs.rm('/proj/node_modules/@valve-tech/gas-oracle')

    const orphaned = run(fs, ['install'])
    expect(orphaned.out).toContain('orphaned   gas-oracle-integration')
    expect(fs.exists('/proj/.claude/skills/gas-oracle-integration/SKILL.md')).toBe(true)

    const pruned = run(fs, ['install', '--prune'])
    expect(pruned.out).toContain('pruned     gas-oracle-integration')
    expect(fs.exists('/proj/.claude/skills/gas-oracle-integration/SKILL.md')).toBe(false)
    expect(parseManifest(fs.readFile(MANIFEST_PATH))['gas-oracle-integration']).toBeUndefined()
  })
})

describe('runCli check', () => {
  it('exits 0 when every tracked skill is in sync', () => {
    const fs = consumerProject()
    run(fs, ['install'])
    const { code, out } = run(fs, ['check'])
    expect(code).toBe(0)
    expect(out).toContain('in-sync')
  })

  it('exits 1 and reports the upgrade after the source package bumps', () => {
    const fs = consumerProject('0.18.0')
    run(fs, ['install'])
    fs.writeFile(
      '/proj/node_modules/@valve-tech/gas-oracle/package.json',
      JSON.stringify({ version: '0.19.0' }),
    )
    const { code, out } = run(fs, ['check'])
    expect(code).toBe(1)
    expect(out).toContain('package-upgraded')
    expect(out).toContain('0.18.0 → 0.19.0')
  })

  it('exits 1 and reports a locally-modified copy', () => {
    const fs = consumerProject()
    run(fs, ['install'])
    fs.writeFile(
      '/proj/.claude/skills/gas-oracle-integration/SKILL.md',
      '# locally hacked',
    )
    const { code, out } = run(fs, ['check'])
    expect(code).toBe(1)
    expect(out).toContain('locally-modified')
  })

  it('exits 1 and reports a source-missing skill', () => {
    const fs = consumerProject()
    run(fs, ['install'])
    fs.rm('/proj/node_modules/@valve-tech/gas-oracle')
    const { code, out } = run(fs, ['check'])
    expect(code).toBe(1)
    expect(out).toContain('source-missing')
  })
})

describe('runCli errors', () => {
  it('exits 2 and prints usage on an unknown command', () => {
    const fs = consumerProject()
    const { code, out } = run(fs, ['frob'])
    expect(code).toBe(2)
    expect(out).toContain('Usage: valve-agent-skills')
  })
})
