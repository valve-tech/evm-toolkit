import { describe, it, expect } from 'vitest'
import { WalletDeclined, WalletUnavailable, DecryptionFailed } from './errors.js'

describe('error classes', () => {
  it('WalletDeclined has the correct name + default message', () => {
    const e = new WalletDeclined()
    expect(e.name).toBe('WalletDeclined')
    expect(e.message).toBe('User declined the signature prompt')
    expect(e).toBeInstanceOf(Error)
  })

  it('WalletDeclined accepts a custom message', () => {
    const e = new WalletDeclined('cancelled in wallet popup')
    expect(e.message).toBe('cancelled in wallet popup')
    expect(e.name).toBe('WalletDeclined')
  })

  it('WalletUnavailable has the correct name + default message', () => {
    const e = new WalletUnavailable()
    expect(e.name).toBe('WalletUnavailable')
    expect(e.message).toBe('WalletClient has no account connected')
  })

  it('WalletUnavailable accepts a custom message', () => {
    const e = new WalletUnavailable('account is locked')
    expect(e.message).toBe('account is locked')
  })

  it('DecryptionFailed has the correct name + default message', () => {
    const e = new DecryptionFailed()
    expect(e.name).toBe('DecryptionFailed')
    expect(e.message).toBe('Decryption failed')
  })

  it('DecryptionFailed accepts a custom message', () => {
    const e = new DecryptionFailed('AEAD tag mismatch')
    expect(e.message).toBe('AEAD tag mismatch')
  })

  // Spec: error classes MUST be instanceof-checkable. Consumers branch
  // on these without parsing .message — proving instanceof works
  // structurally guards against accidental refactors that subclass
  // through a chain that breaks the check.
  it('all errors are instanceof Error AND instanceof their specific class', () => {
    expect(new WalletDeclined()).toBeInstanceOf(Error)
    expect(new WalletUnavailable()).toBeInstanceOf(Error)
    expect(new DecryptionFailed()).toBeInstanceOf(Error)
    expect(new WalletDeclined()).not.toBeInstanceOf(WalletUnavailable)
    expect(new DecryptionFailed()).not.toBeInstanceOf(WalletDeclined)
  })
})
