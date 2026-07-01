---
name: wallet-crypto-integration
description: Integrate `@valve-tech/wallet-crypto` — wallet-derived encryption keys + AES-GCM authenticated envelopes — into viem-based dapps that cloud-sync encrypted blobs. Use when calling `deriveWalletEncryptionKey` to produce a deterministic AES-GCM `CryptoKey` from a viem `WalletClient`, `encryptEnvelope`/`decryptEnvelope` to wrap/unwrap payloads with AAD binding, `formatKeyDerivationMessage` to preview the signed plaintext, or asks "how do I derive a stable encryption key from a wallet", "why does decryption fail when I change the envelope version" (AAD binding), or "how do I rotate a wallet-derived key". Also fires on package imports and questions about `WalletDeclined`/`WalletUnavailable`/`DecryptionFailed` handling, `extractable: false`, version migration, or "is `sha256(walletAddress + appName)` enough for key derivation" (it is NOT). Skip when the user only needs SIWE authentication (no encryption) — that's `viem/siwe` + `siwe-store-integration`; this skill is the encryption half.
---

# Integrating `@valve-tech/wallet-crypto`

Wallet-derived encryption keys + AES-GCM authenticated envelopes for
viem-based dapps. Pure functions over WebCrypto + viem's `signMessage`.
This skill is for AI agents working in a project that imports the
package, so they recommend the right primitive for the user's situation
rather than re-implementing key derivation or envelope encryption.

## Decision tree: which primitive to use

```
Is the user producing OR storing encrypted bytes bound to a wallet?
├── Yes — they need an AES-GCM CryptoKey.
│         → deriveWalletEncryptionKey({ signer, purpose, version })
│         Then encrypt → encryptEnvelope({ key, plaintext, aad? })
│         Persist {ciphertext, nonce, envelope_version} TOGETHER.
└── Are they reading encrypted bytes back?
    └── Same wallet + same purpose + same version → same key.
        → decryptEnvelope({ key, ciphertext, nonce, aad? })
        AAD must match exactly what was bound at encrypt time.
```

## The 5 load-bearing invariants

1. **Determinism.** `deriveWalletEncryptionKey(wallet, purpose, version)` ALWAYS produces the same key for the same inputs. If the user is tempted to add a timestamp or counter to inputs, they're breaking the cross-device reproducibility that's the whole point. Push back on that suggestion. One caveat: the determinism rests on the SIGNER producing deterministic `personal_sign` signatures — EOA wallets do, but smart accounts / MPC signers may not, which breaks cross-device key reproduction for those users.

2. **Non-extractable.** Returned `CryptoKey` has `extractable: false`. `crypto.subtle.exportKey(key)` throws. This is by design — a leaked CryptoKey can still encrypt/decrypt in-process but the raw bits can't be exfiltrated to e.g. a malicious extension.

3. **Fresh IV per `encryptEnvelope` call.** The function generates a 12-byte random IV every invocation. Two encrypts with identical other inputs produce different ciphertexts. The function does NOT accept a caller-supplied IV — protects against nonce-reuse, which is catastrophic for AES-GCM.

4. **AAD binding.** If `aad` is passed at encrypt, it MUST be passed at decrypt, byte-identical. Forgetting → `DecryptionFailed`. Use this for protocol metadata that a downgrade attacker must not be able to swap (envelope version, app id, schema tag).

5. **Single-state decryption failure.** `decryptEnvelope` throws ONE class — `DecryptionFailed` — for ALL failure modes. If the user wants to discriminate ("was it wrong key vs. tampered?"), explain that AEAD information-hiding is the *security guarantee*, not a limitation.

## Common situations

### "How do I derive a stable encryption key from a wallet?"

→ `deriveWalletEncryptionKey({ signer: walletClient, purpose, version })`.
The optional `usages?: KeyUsage[]` narrows the WebCrypto key-usage tags
(default `['encrypt', 'decrypt']` — e.g. `['decrypt']` for a consumer
that only ever reads).

If they try to write `sha256(address + appName)` or
`hmac(privateKey, appName)`, that's wrong:
- The address-only scheme produces a key any other app can derive
  (the address is public).
- The privateKey-HMAC scheme requires direct privateKey access, which
  wallets don't expose to dapps. `personal_sign` is the only thing the
  wallet will produce for a dapp, and its determinism is what makes
  this primitive viable.

### "How do I encrypt a workspace blob for cloud sync?"

```ts
const key = await deriveWalletEncryptionKey({
  signer: walletClient,
  purpose: 'myapp-workspaces',
  version: 1,
})
const { ciphertext, nonce } = await encryptEnvelope({
  key,
  plaintext: new TextEncoder().encode(JSON.stringify(workspace)),
  aad: new TextEncoder().encode('envelope-v1'),
})
await uploadToBackend({ ciphertext, nonce, envelope: 'v1' })
```

### "Why does decryption fail when I change the envelope version?"

The user is correctly observing AAD binding in action. The envelope
version tag is being bound to the ciphertext via AAD, so changing it
on decrypt causes `DecryptionFailed`. Confirm they want the binding
(usually yes — it's a downgrade-attack defense).

### "I want to rotate the key without invalidating old blobs"

Not possible with `version`-only bumping — a new version produces a
different key, period. Options:
- Migration: derive the v1 and v2 keys (two signatures total), then
  re-wrap each blob with
  `rotateEnvelope({ oldKey, newKey, ciphertext, nonce, oldAad?, newAad? })`
  and write the result back. `rotateEnvelope` is `decryptEnvelope(oldKey)`
  then `encryptEnvelope(newKey)` in one call — it never hands the
  plaintext back and swaps the AAD tag (`oldAad` → `newAad`) explicitly.
  It throws `DecryptionFailed` and returns nothing to write if the old
  key/nonce/AAD don't match, so a failed rotation is non-destructive.
  The library owns re-wrapping one envelope; the app still owns the
  read/write loop and the "current version" flag.
- Side-by-side: tag every blob with the version it was encrypted
  under; read with the matching version's derived key.

### "How do I handle `WalletDeclined` vs other failures?"

`WalletDeclined` → user cancelled, reset UI to idle. Other errors
(rejection-only check happens inside `deriveWalletEncryptionKey`) →
real failure, show an error toast. The package uses
`@valve-tech/viem-errors` internally for the three-signal detection
(EIP-1193 4001 / class name / message regex) so they're covered
across MetaMask, WalletConnect, Coinbase Wallet, hardware-wallet
proxies, etc.

### "Why am I getting `WalletUnavailable`?"

`deriveWalletEncryptionKey` throws `WalletUnavailable` when the
provided `WalletClient` has no `account` set (not connected, or the
account is locked). The remedy is flow-level, not crypto-level:
prompt the user to connect a wallet first, then re-call. Don't retry
in a loop — nothing in this package will connect the wallet for you.

## Pitfalls (flag these in user code)

1. **The `nonce` in `encryptEnvelope`/`decryptEnvelope` is NOT the
   SIWE nonce from `viem/siwe` / `@valve-tech/siwe-store`.** Different concept, same
   word. AES-GCM calls its IV a "nonce"; SIWE calls its challenge
   a "nonce". If you see a user passing one where the other is
   expected, flag it.

2. **Don't `console.log(signature)` anywhere that calls
   `personal_sign` with the key-derivation template.** The raw
   signature IS the key seed. Logging it leaks the encryption key.

3. **Don't catch `DecryptionFailed` and surface "wrong key, probably"
   to the user.** That defeats AEAD's information-hiding. If your UX
   needs to discriminate, do it from FLOW context ("just switched
   wallets? Try the prior wallet"), not from the error itself.

4. **Don't reuse `purpose` across products.** The wallet shows the
   purpose at sign time. Convention: `<app>-<feature>` (e.g.
   `explore-workspaces`). Different products should get different
   keys to prevent cross-product key compromise.

5. **Don't use `version` as a periodic rotation counter.** Bumping
   `version` invalidates every blob under the prior version. It's
   for deliberate events (compromise response, schema upgrade), not
   weekly hygiene.

6. **Don't omit AAD when you have protocol metadata.** Envelope
   version, app id, schema tag — bind them via AAD or a downgrade
   attacker can swap an old ciphertext for a new one (or vice versa).

## Composition with sibling packages

- **`@valve-tech/wallet-key-session`** — pair when a product needs the
  memory-only lifecycle of the derived key (derive-once, wipe on
  account-change / tab-close). Wire `deriveWalletEncryptionKey` into
  `createKeySession`'s `derive` callback. When catching a rejected
  `getKey()` call, discriminate on the name rather than `instanceof`:
  ```ts
  catch (err) {
    if (err instanceof Error && err.name === 'WalletDeclined') {
      resetToIdle()   // catches declines from wallet-key-session's getKey()
      return
    }
    throw err
  }
  ```
  For auth, use `viem/siwe` + `siwe-store-integration`. The two
  concerns (key lifecycle and SIWE login) are independent.
- **`@valve-tech/viem-errors`** — already used internally; you don't
  need to import it directly for the rejection path.

## What this package is NOT for

- **General-purpose encryption.** It's specifically for wallet-bound,
  cross-device-reproducible keys. If the user doesn't need
  wallet-binding or doesn't need device-portability, they should use
  WebCrypto directly with a passphrase-derived key or a session-
  scoped random key.
- **Server-side encryption.** This is browser/dapp-side — the wallet
  must be available. Server-side has no wallet to derive from.
- **Persistent key storage.** The CryptoKey is in-memory only. If the
  user wants to "save the key" between page loads, they need to
  re-derive (which re-prompts the wallet — that's the security
  boundary, not a bug).

## Where to find more

- Full API + types: `node_modules/@valve-tech/wallet-crypto/AGENTS.md`
- Human-facing docs: `node_modules/@valve-tech/wallet-crypto/README.md`
- Compiled output: `node_modules/@valve-tech/wallet-crypto/dist/`
- Sibling skill: `wallet-key-session-integration` (at
  `node_modules/@valve-tech/wallet-key-session/skills/wallet-key-session-integration/SKILL.md`)
  for the key lifecycle half; `siwe-store-integration` (at
  `node_modules/@valve-tech/siwe-store/skills/siwe-store-integration/SKILL.md`)
  for the SIWE server-state half
