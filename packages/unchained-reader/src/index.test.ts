import { describe, it, expect } from 'vitest'

import * as api from './index.js'

// The public surface is a contract: an accidental drop of an export is a
// breaking change. Assert the entry points exist and are callable.
describe('public API surface', () => {
  it('exports the orchestrator + factories as functions', () => {
    expect(typeof api.createUnchainedReader).toBe('function')
    expect(typeof api.createFetcher).toBe('function')
  })

  it('exports the pure parsers as functions', () => {
    expect(typeof api.parseManifest).toBe('function')
    expect(typeof api.parseBloom).toBe('function')
    expect(typeof api.mightContain).toBe('function')
    expect(typeof api.parseChunkHeader).toBe('function')
    expect(typeof api.appearancesOf).toBe('function')
  })

  it('exports address helpers and constants', () => {
    expect(typeof api.normalizeAddress).toBe('function')
    expect(api.ACCEPTED_VERSION).toBe('trueblocks-core@v2.0.0-release')
    expect(api.FailureReason.fetch).toBe('fetch')
    expect(api.FailureReason.parse).toBe('parse')
  })
})
