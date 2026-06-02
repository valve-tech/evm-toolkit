import { describe, it, expect } from 'vitest'
import {
  WalletDeclined,
  WalletUnavailable,
  InvalidNonce,
  SignatureMismatch,
} from './errors.js'

describe('error classes', () => {
  it.each([
    { Cls: WalletDeclined, name: 'WalletDeclined', defaultMsg: 'User declined the signature prompt' },
    { Cls: WalletUnavailable, name: 'WalletUnavailable', defaultMsg: 'WalletClient has no account connected' },
    { Cls: InvalidNonce, name: 'InvalidNonce', defaultMsg: 'Nonce failed structural sanity check' },
    { Cls: SignatureMismatch, name: 'SignatureMismatch', defaultMsg: 'Recovered address does not match claimed address' },
  ])('$name has correct name + default + custom messages', ({ Cls, name, defaultMsg }) => {
    const e = new Cls()
    expect(e.name).toBe(name)
    expect(e.message).toBe(defaultMsg)
    expect(e).toBeInstanceOf(Error)
    const custom = new Cls('custom message')
    expect(custom.message).toBe('custom message')
    expect(custom.name).toBe(name)
  })

  it('all errors are instanceof Error but not each other', () => {
    expect(new WalletDeclined()).not.toBeInstanceOf(WalletUnavailable)
    expect(new InvalidNonce()).not.toBeInstanceOf(SignatureMismatch)
    expect(new WalletDeclined()).not.toBeInstanceOf(InvalidNonce)
  })
})
