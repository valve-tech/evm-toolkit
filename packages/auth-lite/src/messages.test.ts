import { describe, it, expect } from 'vitest'
import { formatAuthMessage, AUTH_MESSAGE_TEMPLATE } from './messages.js'

describe('formatAuthMessage', () => {
  it('renders the canonical 4-line template', () => {
    const msg = formatAuthMessage({ app: 'Explore', nonce: 'abc123' })
    expect(msg).toBe(
      'Sign in to Explore\n' +
      'Nonce: abc123\n' +
      '\n' +
      'This signature authenticates your session. It does NOT authorize any transaction or transfer.'
    )
  })

  it('different app produces different plaintext', () => {
    const a = formatAuthMessage({ app: 'A', nonce: 'n' })
    const b = formatAuthMessage({ app: 'B', nonce: 'n' })
    expect(a).not.toBe(b)
  })

  it('different nonce produces different plaintext', () => {
    const a = formatAuthMessage({ app: 'A', nonce: 'n1' })
    const b = formatAuthMessage({ app: 'A', nonce: 'n2' })
    expect(a).not.toBe(b)
  })

  it('is deterministic — same args → byte-identical output', () => {
    const a = formatAuthMessage({ app: 'A', nonce: 'n' })
    const b = formatAuthMessage({ app: 'A', nonce: 'n' })
    expect(a).toBe(b)
  })

  it('always contains the "does NOT authorize" anti-phishing line', () => {
    const msg = formatAuthMessage({ app: 'X', nonce: 'whatever' })
    expect(msg).toContain('does NOT authorize any transaction or transfer')
  })

  it('AUTH_MESSAGE_TEMPLATE contains both placeholders', () => {
    expect(AUTH_MESSAGE_TEMPLATE).toContain('{app}')
    expect(AUTH_MESSAGE_TEMPLATE).toContain('{nonce}')
  })
})
