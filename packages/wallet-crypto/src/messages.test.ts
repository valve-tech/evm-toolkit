import { describe, it, expect } from 'vitest'
import { formatKeyDerivationMessage } from './messages.js'

describe('formatKeyDerivationMessage', () => {
  it('renders the canonical 5-line template', () => {
    const msg = formatKeyDerivationMessage({ purpose: 'explore-workspaces', version: 1 })
    expect(msg).toBe(
      'Wallet key derivation\n' +
      'Purpose: explore-workspaces\n' +
      'Version: 1\n' +
      '\n' +
      'This signature derives an encryption key. It does NOT authorize any transaction or transfer.'
    )
  })

  it('different purpose produces different plaintext', () => {
    const a = formatKeyDerivationMessage({ purpose: 'a', version: 1 })
    const b = formatKeyDerivationMessage({ purpose: 'b', version: 1 })
    expect(a).not.toBe(b)
  })

  it('different version produces different plaintext', () => {
    const a = formatKeyDerivationMessage({ purpose: 'p', version: 1 })
    const b = formatKeyDerivationMessage({ purpose: 'p', version: 2 })
    expect(a).not.toBe(b)
  })

  it('is deterministic — same args → byte-identical output', () => {
    const a = formatKeyDerivationMessage({ purpose: 'p', version: 5 })
    const b = formatKeyDerivationMessage({ purpose: 'p', version: 5 })
    expect(a).toBe(b)
  })

  it('always contains the "does NOT authorize" anti-phishing line', () => {
    // The trailing assurance line is contract-mandated: wallets show
    // the raw signed bytes, and users must see this before clicking
    // confirm. If this test fails after a message-template change,
    // the consumer contract has been broken.
    const msg = formatKeyDerivationMessage({ purpose: 'x', version: 99 })
    expect(msg).toContain('does NOT authorize any transaction or transfer')
  })
})
