import { describe, it, expect } from 'vitest'
import { encryptEnvelope, decryptEnvelope, rotateEnvelope } from './envelope.js'
import { DecryptionFailed } from './errors.js'
import { deriveWalletEncryptionKey } from './derive-key.js'
import { makeMockSigner, randomBytes, TEST_PRIVATE_KEY_A, TEST_PRIVATE_KEY_B } from './test-helpers.js'

const makeKey = async (priv = TEST_PRIVATE_KEY_A, purpose = 'p', version = 1) =>
  deriveWalletEncryptionKey({ signer: makeMockSigner(priv), purpose, version })

describe('encryptEnvelope / decryptEnvelope', () => {
  // Spec testing obligation #4: roundtrip across multiple sizes.
  it('roundtrips a 1-byte plaintext', async () => {
    const key = await makeKey()
    const plaintext = new Uint8Array([0x42])
    const { ciphertext, nonce } = await encryptEnvelope({ key, plaintext })
    const decrypted = await decryptEnvelope({ key, ciphertext, nonce })
    expect(decrypted).toEqual(plaintext)
  })

  it('roundtrips a 1KB plaintext', async () => {
    const key = await makeKey()
    const plaintext = randomBytes(1024)
    const { ciphertext, nonce } = await encryptEnvelope({ key, plaintext })
    const decrypted = await decryptEnvelope({ key, ciphertext, nonce })
    expect(decrypted).toEqual(plaintext)
  })

  it('roundtrips a 1MB plaintext', async () => {
    const key = await makeKey()
    const plaintext = randomBytes(1024 * 1024)
    const { ciphertext, nonce } = await encryptEnvelope({ key, plaintext })
    const decrypted = await decryptEnvelope({ key, ciphertext, nonce })
    expect(decrypted).toEqual(plaintext)
  })

  it('returns a 12-byte random nonce per call', async () => {
    const key = await makeKey()
    const plaintext = new Uint8Array([0])
    const a = await encryptEnvelope({ key, plaintext })
    const b = await encryptEnvelope({ key, plaintext })
    expect(a.nonce.length).toBe(12)
    expect(b.nonce.length).toBe(12)
    expect(a.nonce).not.toEqual(b.nonce)
    // Same plaintext + same key + different IV → different ciphertext
    expect(a.ciphertext).not.toEqual(b.ciphertext)
  })

  it('roundtrips with AAD', async () => {
    const key = await makeKey()
    const plaintext = new TextEncoder().encode('hello')
    const aad = new TextEncoder().encode('envelope-v1')
    const { ciphertext, nonce } = await encryptEnvelope({ key, plaintext, aad })
    const decrypted = await decryptEnvelope({ key, ciphertext, nonce, aad })
    expect(decrypted).toEqual(plaintext)
  })

  // Spec testing obligation #5: AAD binding.
  it('decryption fails when AAD is changed (downgrade prevention)', async () => {
    const key = await makeKey()
    const plaintext = new TextEncoder().encode('payload')
    const { ciphertext, nonce } = await encryptEnvelope({
      key,
      plaintext,
      aad: new TextEncoder().encode('envelope-v1'),
    })
    await expect(
      decryptEnvelope({
        key,
        ciphertext,
        nonce,
        aad: new TextEncoder().encode('envelope-v2'),
      }),
    ).rejects.toBeInstanceOf(DecryptionFailed)
  })

  it('decryption fails when AAD was bound at encrypt but omitted at decrypt', async () => {
    const key = await makeKey()
    const plaintext = new TextEncoder().encode('payload')
    const { ciphertext, nonce } = await encryptEnvelope({
      key,
      plaintext,
      aad: new TextEncoder().encode('envelope-v1'),
    })
    await expect(decryptEnvelope({ key, ciphertext, nonce })).rejects.toBeInstanceOf(
      DecryptionFailed,
    )
  })

  it('decryption fails with a tampered ciphertext byte', async () => {
    const key = await makeKey()
    const plaintext = new TextEncoder().encode('payload')
    const { ciphertext, nonce } = await encryptEnvelope({ key, plaintext })
    // Flip one bit in the ciphertext.
    const tampered = new Uint8Array(ciphertext)
    tampered[0] ^= 0x01
    await expect(decryptEnvelope({ key, ciphertext: tampered, nonce })).rejects.toBeInstanceOf(
      DecryptionFailed,
    )
  })

  it('decryption fails with the wrong key (different wallet)', async () => {
    const keyA = await makeKey(TEST_PRIVATE_KEY_A)
    const keyB = await makeKey(TEST_PRIVATE_KEY_B)
    const plaintext = new TextEncoder().encode('payload')
    const { ciphertext, nonce } = await encryptEnvelope({ key: keyA, plaintext })
    await expect(decryptEnvelope({ key: keyB, ciphertext, nonce })).rejects.toBeInstanceOf(
      DecryptionFailed,
    )
  })

  it('decryption fails with the wrong key (cross-purpose key derived from same wallet)', async () => {
    const keyP = await makeKey(TEST_PRIVATE_KEY_A, 'purpose-a', 1)
    const keyQ = await makeKey(TEST_PRIVATE_KEY_A, 'purpose-b', 1)
    const plaintext = new TextEncoder().encode('payload')
    const { ciphertext, nonce } = await encryptEnvelope({ key: keyP, plaintext })
    await expect(decryptEnvelope({ key: keyQ, ciphertext, nonce })).rejects.toBeInstanceOf(
      DecryptionFailed,
    )
  })

  it('decryption fails when the IV is changed', async () => {
    const key = await makeKey()
    const plaintext = new TextEncoder().encode('payload')
    const { ciphertext } = await encryptEnvelope({ key, plaintext })
    const wrongNonce = crypto.getRandomValues(new Uint8Array(12))
    await expect(decryptEnvelope({ key, ciphertext, nonce: wrongNonce })).rejects.toBeInstanceOf(
      DecryptionFailed,
    )
  })
})

describe('rotateEnvelope', () => {
  // Old and new keys are the same wallet + purpose at successive versions —
  // the canonical rotation: bump the version, re-wrap every blob.
  const oldKeyFor = () => makeKey(TEST_PRIVATE_KEY_A, 'vault', 1)
  const newKeyFor = () => makeKey(TEST_PRIVATE_KEY_A, 'vault', 2)

  it('re-wraps so the new key decrypts and the old key no longer can', async () => {
    const oldKey = await oldKeyFor()
    const newKey = await newKeyFor()
    const plaintext = new TextEncoder().encode('secret note')
    const original = await encryptEnvelope({ key: oldKey, plaintext })

    const rotated = await rotateEnvelope({
      oldKey,
      newKey,
      ciphertext: original.ciphertext,
      nonce: original.nonce,
    })

    // Content survives the rotation, readable under the new key.
    const decrypted = await decryptEnvelope({
      key: newKey,
      ciphertext: rotated.ciphertext,
      nonce: rotated.nonce,
    })
    expect(decrypted).toEqual(plaintext)

    // The retired key cannot read the rotated ciphertext.
    await expect(
      decryptEnvelope({ key: oldKey, ciphertext: rotated.ciphertext, nonce: rotated.nonce }),
    ).rejects.toBeInstanceOf(DecryptionFailed)
  })

  it('produces a fresh IV and unrelated ciphertext', async () => {
    const oldKey = await oldKeyFor()
    const newKey = await newKeyFor()
    const plaintext = new TextEncoder().encode('payload')
    const original = await encryptEnvelope({ key: oldKey, plaintext })

    const rotated = await rotateEnvelope({
      oldKey,
      newKey,
      ciphertext: original.ciphertext,
      nonce: original.nonce,
    })
    expect(rotated.nonce.length).toBe(12)
    expect(rotated.nonce).not.toEqual(original.nonce)
    expect(rotated.ciphertext).not.toEqual(original.ciphertext)
  })

  it('swaps AAD: rebinds from the old tag to the new tag', async () => {
    const oldKey = await oldKeyFor()
    const newKey = await newKeyFor()
    const plaintext = new TextEncoder().encode('payload')
    const oldAad = new TextEncoder().encode('envelope-v1')
    const newAad = new TextEncoder().encode('envelope-v2')
    const original = await encryptEnvelope({ key: oldKey, plaintext, aad: oldAad })

    const rotated = await rotateEnvelope({
      oldKey,
      newKey,
      ciphertext: original.ciphertext,
      nonce: original.nonce,
      oldAad,
      newAad,
    })

    // Bound under the new AAD.
    const decrypted = await decryptEnvelope({
      key: newKey,
      ciphertext: rotated.ciphertext,
      nonce: rotated.nonce,
      aad: newAad,
    })
    expect(decrypted).toEqual(plaintext)

    // The old AAD no longer opens it.
    await expect(
      decryptEnvelope({ key: newKey, ciphertext: rotated.ciphertext, nonce: rotated.nonce, aad: oldAad }),
    ).rejects.toBeInstanceOf(DecryptionFailed)
  })

  it('fails (leaving nothing to write) when the old key is wrong', async () => {
    const wrongOldKey = await makeKey(TEST_PRIVATE_KEY_B, 'vault', 1)
    const newKey = await newKeyFor()
    const plaintext = new TextEncoder().encode('payload')
    // Encrypted under the real old key, but rotation is attempted with the wrong one.
    const realOldKey = await oldKeyFor()
    const original = await encryptEnvelope({ key: realOldKey, plaintext })

    await expect(
      rotateEnvelope({
        oldKey: wrongOldKey,
        newKey,
        ciphertext: original.ciphertext,
        nonce: original.nonce,
      }),
    ).rejects.toBeInstanceOf(DecryptionFailed)
  })

  it('fails when the bound oldAad is not supplied', async () => {
    const oldKey = await oldKeyFor()
    const newKey = await newKeyFor()
    const plaintext = new TextEncoder().encode('payload')
    const original = await encryptEnvelope({
      key: oldKey,
      plaintext,
      aad: new TextEncoder().encode('envelope-v1'),
    })

    await expect(
      rotateEnvelope({
        oldKey,
        newKey,
        ciphertext: original.ciphertext,
        nonce: original.nonce,
        // oldAad omitted — decrypt half must fail.
      }),
    ).rejects.toBeInstanceOf(DecryptionFailed)
  })
})
