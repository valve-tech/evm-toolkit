# AGENTS.md

Terse reference for AI agents (Claude Code, Cursor, Aider) integrating
`@valve-tech/wallet-crypto`. Full README is for humans; this file is
for agents that need the package's actual surface fast.

## What this package does

Deterministic wallet-derived encryption keys + AES-GCM authenticated
envelope encryption. Two primitives, no storage, no state.

1. `deriveWalletEncryptionKey({ signer, purpose, version })`
   → `CryptoKey` (non-extractable). Same wallet+purpose+version →
   same key, byte-for-byte, every time, on every device.
2. `encryptEnvelope` / `decryptEnvelope` — WebCrypto AES-GCM with
   AAD support. Single-state authenticated failure (`DecryptionFailed`).

Peer-deps `viem`. No runtime storage, no nonce store, no session token
issuance — those are the consumer's job.

## Public API

```ts
import {
  // Key derivation
  deriveWalletEncryptionKey,
  formatKeyDerivationMessage,
  // Envelope encryption
  encryptEnvelope,
  decryptEnvelope,
  // Typed errors
  WalletDeclined,
  WalletUnavailable,
  DecryptionFailed,
} from '@valve-tech/wallet-crypto'
```

## Decision tree: which primitive

```
Are you producing OR storing encrypted bytes derived from a wallet?
├── Yes — you need a key. Use `deriveWalletEncryptionKey`.
│         Then encrypt with `encryptEnvelope`.
│         Persist `{ ciphertext, nonce, envelope_version }` together.
└── Are you reading encrypted bytes back?
    └── Use the SAME purpose+version to derive the key →
        `decryptEnvelope`. AAD must match what was bound at encrypt.
```

## The 5 invariants (read these — they're load-bearing)

1. **Determinism.** `deriveWalletEncryptionKey` is deterministic for
   `(wallet, purpose, version)`. Don't add entropy (timestamps,
   counters, salts) to the inputs — that breaks the cross-device
   reproducibility that's the whole point.

2. **Non-extractable.** The returned `CryptoKey` has
   `extractable: false`. `crypto.subtle.exportKey(key)` will throw.
   This is a feature: a leaked CryptoKey can still encrypt/decrypt,
   but the raw bits can't be exfiltrated to e.g. a malicious
   extension.

3. **AES-GCM IV (`nonce`) is fresh-random per `encryptEnvelope`
   call.** Two calls with identical other inputs return different
   ciphertexts. Don't pre-supply an IV — the function doesn't accept
   one, intentionally.

4. **AAD binding.** If you pass `aad` on encrypt, you MUST pass the
   exact same `aad` on decrypt. Forgetting → `DecryptionFailed`.
   Use this to bind protocol metadata that a downgrade attacker must
   not be able to swap (e.g. envelope-version tag).

5. **Single-state decryption failure.** `decryptEnvelope` throws one
   class — `DecryptionFailed` — for ALL failure modes (wrong key,
   tamper, bad AAD, bad IV). Don't try to discriminate. AEAD is
   designed to leak nothing about which check failed.

## Pitfalls

1. **The `nonce` returned by `encryptEnvelope` is NOT the auth nonce
   from `@valve-tech/auth-lite`.** Different concept, same word.
   AES-GCM calls its IV a "nonce"; SIWE-lite calls its challenge a
   "nonce". They are unrelated. Don't pass one where the other is
   expected.

2. **Don't catch and re-throw `DecryptionFailed` with a "wrong key
   probably" message.** That defeats the AEAD's information-hiding.
   If your UX needs to discriminate, do it from the user's flow
   context (just connected a different wallet? Show "wallet
   mismatch" hint), not from the error.

3. **Don't store the raw signature anywhere.** The
   `personal_sign` output IS the key seed. If you sign the same
   `formatKeyDerivationMessage(...)` somewhere else and log the
   result, you've leaked the encryption key.

4. **Don't reuse the same `purpose` across products.** The wallet
   sees the purpose string at sign time. Convention: `<app>-<feature>`
   (e.g. `explore-workspaces`). Different products on the same
   wallet should get different keys.

5. **Don't use `version` as a "rotate weekly" counter.** Bumping
   `version` invalidates every blob encrypted under the prior
   version. It's for deliberate rotation events (compromise response,
   schema upgrade), not regular hygiene.

## Composition

- **With `@valve-tech/auth-lite`**: pair them when a product needs
  both auth + encrypted storage. They share `WalletDeclined` /
  `WalletUnavailable` class names (re-exported from both packages) so
  consumers can `catch (e)` once.
- **With `@valve-tech/viem-errors`**: this package uses
  `isUserRejectionError` internally — you don't need to import
  viem-errors directly to handle the rejection case, the
  `WalletDeclined` throw already covers all three signals
  (EIP-1193 4001, class name, message regex).

## Skills

`skills/wallet-crypto-integration/SKILL.md` ships in the npm tarball
for AI agents in consumer projects.

## Verifying provenance

```bash
npm view @valve-tech/wallet-crypto@latest --json | jq .dist.attestations
npm audit signatures
```
