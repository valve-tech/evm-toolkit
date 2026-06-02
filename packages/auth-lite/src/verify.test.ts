import { describe, it, expect } from 'vitest'
import { signAuthChallenge } from './challenge.js'
import { verifyAuthSignature } from './verify.js'
import {
  makeMockSigner,
  TEST_ADDRESS_A,
  TEST_ADDRESS_B,
  TEST_PRIVATE_KEY_A,
  TEST_PRIVATE_KEY_B,
  VALID_NONCE,
} from './test-helpers.js'

describe('verifyAuthSignature', () => {
  // Spec testing obligation #7: known-good signature verifies.
  it('returns the recovered address on a valid signature', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    const { signature, address } = await signAuthChallenge({
      signer,
      app: 'Test',
      nonce: VALID_NONCE,
    })
    const recovered = await verifyAuthSignature({
      app: 'Test',
      nonce: VALID_NONCE,
      signature,
      claimedAddress: address,
    })
    expect(recovered?.toLowerCase()).toBe(TEST_ADDRESS_A.toLowerCase())
  })

  it('returns null when the signature is for a different nonce', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    const { signature, address } = await signAuthChallenge({
      signer,
      app: 'Test',
      nonce: VALID_NONCE,
    })
    const recovered = await verifyAuthSignature({
      app: 'Test',
      nonce: 'differentNonce_AbCdEfGhIjKlMnOpQrStUvWxYz0123', // valid shape, different value
      signature,
      claimedAddress: address,
    })
    expect(recovered).toBeNull()
  })

  // Spec testing obligation #8: cross-app rejection.
  it('returns null when the signature is for a different app', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    const { signature, address } = await signAuthChallenge({
      signer,
      app: 'AppA',
      nonce: VALID_NONCE,
    })
    const recovered = await verifyAuthSignature({
      app: 'AppB',
      nonce: VALID_NONCE,
      signature,
      claimedAddress: address,
    })
    expect(recovered).toBeNull()
  })

  // Spec testing obligation #7 (continued): bit-flip → fail.
  it('returns null when a bit is flipped in the signature', async () => {
    const signer = makeMockSigner(TEST_PRIVATE_KEY_A)
    const { signature, address } = await signAuthChallenge({
      signer,
      app: 'Test',
      nonce: VALID_NONCE,
    })
    // Flip a hex nibble in the middle of the signature.
    const flippedChar = signature[20] === 'a' ? 'b' : 'a'
    const tampered = (signature.slice(0, 20) + flippedChar + signature.slice(21)) as `0x${string}`
    const recovered = await verifyAuthSignature({
      app: 'Test',
      nonce: VALID_NONCE,
      signature: tampered,
      claimedAddress: address,
    })
    expect(recovered).toBeNull()
  })

  it('returns null on the SignatureMismatch case (recovered != claimed)', async () => {
    // Sign with key A but claim address B.
    const signerA = makeMockSigner(TEST_PRIVATE_KEY_A)
    const { signature } = await signAuthChallenge({
      signer: signerA,
      app: 'Test',
      nonce: VALID_NONCE,
    })
    const recovered = await verifyAuthSignature({
      app: 'Test',
      nonce: VALID_NONCE,
      signature,
      claimedAddress: TEST_ADDRESS_B,
    })
    expect(recovered).toBeNull()
  })

  it('returns null on a malformed signature (constant null path)', async () => {
    const recovered = await verifyAuthSignature({
      app: 'Test',
      nonce: VALID_NONCE,
      signature: '0x00' as `0x${string}`,
      claimedAddress: TEST_ADDRESS_A,
    })
    expect(recovered).toBeNull()
  })

  it('verifies key B → A would be rejected (different signers produce different sigs)', async () => {
    const signerB = makeMockSigner(TEST_PRIVATE_KEY_B)
    const { signature } = await signAuthChallenge({
      signer: signerB,
      app: 'Test',
      nonce: VALID_NONCE,
    })
    // Claim address A — recovered will be B, mismatch.
    const recovered = await verifyAuthSignature({
      app: 'Test',
      nonce: VALID_NONCE,
      signature,
      claimedAddress: TEST_ADDRESS_A,
    })
    expect(recovered).toBeNull()
  })
})
