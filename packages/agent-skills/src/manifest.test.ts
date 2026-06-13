import { describe, it, expect } from 'vitest'
import { parseManifest, serializeManifest, type Manifest } from './manifest.js'

describe('parseManifest', () => {
  it('returns an empty manifest for null (missing file)', () => {
    expect(parseManifest(null)).toEqual({})
  })

  it('returns an empty manifest for invalid JSON rather than throwing', () => {
    expect(parseManifest('{ not json')).toEqual({})
  })

  it('returns an empty manifest for non-object JSON (array, string, number)', () => {
    expect(parseManifest('[]')).toEqual({})
    expect(parseManifest('"hi"')).toEqual({})
    expect(parseManifest('42')).toEqual({})
    expect(parseManifest('null')).toEqual({})
  })

  it('parses a well-formed manifest object', () => {
    const m: Manifest = {
      'gas-oracle-integration': {
        package: '@valve-tech/gas-oracle',
        version: '0.18.0',
        files: [{ path: 'SKILL.md', sha256: 'abc' }],
      },
    }
    expect(parseManifest(JSON.stringify(m))).toEqual(m)
  })
})

describe('serializeManifest', () => {
  it('sorts keys and ends with a trailing newline', () => {
    const m: Manifest = {
      'z-skill': { package: '@valve-tech/z', version: '0.18.0', files: [] },
      'a-skill': { package: '@valve-tech/a', version: '0.18.0', files: [] },
    }
    const out = serializeManifest(m)
    expect(out.endsWith('\n')).toBe(true)
    expect(out.indexOf('a-skill')).toBeLessThan(out.indexOf('z-skill'))
  })

  it('round-trips through parseManifest', () => {
    const m: Manifest = {
      's': { package: '@valve-tech/s', version: '1.2.3', files: [{ path: 'SKILL.md', sha256: 'x' }] },
    }
    expect(parseManifest(serializeManifest(m))).toEqual(m)
  })
})
