# `@valve-tech/wallet-crypto`

Wallet-derived encryption keys + AES-GCM authenticated envelopes for
viem-based dapps. Same wallet + same purpose + same version derives the
same `CryptoKey` on any device, forever. Encrypt with AAD-bound
envelopes; decryption is single-state authenticated.

Pure functions. Peer-deps viem; runtime is WebCrypto.

```bash
npm install @valve-tech/wallet-crypto viem
```

## What it solves

Every wallet-gated product that wants to cloud-sync encrypted blobs
has to write:

1. A deterministic key-derivation step (so the encrypted blob can be
   opened on the user's next device without server-side key escrow).
2. An AEAD encrypt/decrypt envelope (so the cloud can't read blobs
   and so tampering is detected).

Both have well-trodden footguns: weak key derivation that lets a
malicious app extract the key, AES-GCM IV reuse, missing AAD that
allows downgrade attacks. This package handles them once.

## API

```ts
import {
  deriveWalletEncryptionKey,
  encryptEnvelope,
  decryptEnvelope,
  formatKeyDerivationMessage,
  WalletDeclined,
  WalletUnavailable,
  DecryptionFailed,
} from '@valve-tech/wallet-crypto'
```

### `deriveWalletEncryptionKey({ signer, purpose, version, usages? })`

Returns a non-extractable AES-GCM `CryptoKey`.

```ts
const key = await deriveWalletEncryptionKey({
  signer: walletClient,
  purpose: 'explore-workspaces',
  version: 1,
})
```

How it works: signs `formatKeyDerivationMessage({ purpose, version })`
via `personal_sign`, SHA-256s the signature bytes to get 256 bits of
key material, imports as `extractable: false`. The signature bytes
never leave the function.

**Versioning + key rotation.** Bumping `version` invalidates every
blob encrypted under the old key. Migration is per-product:

1. App reads its old blob, decrypts with v1 key.
2. App derives v2 key.
3. App re-encrypts with v2, writes back.
4. App updates its persisted "current version" flag.

The library doesn't own this loop — it owns deriving distinct keys
per version.

### `encryptEnvelope({ key, plaintext, aad? })`

Returns `{ ciphertext, nonce }`. The `nonce` is the 12-byte AES-GCM
IV — **not** an auth nonce. Don't confuse them.

```ts
const { ciphertext, nonce } = await encryptEnvelope({
  key,
  plaintext: new TextEncoder().encode(blob),
  aad: new TextEncoder().encode('envelope-v1'),
})
```

Use `aad` to bind protocol metadata (envelope version, app id) so a
downgrade attack can't swap an old ciphertext for a new one. The AAD
isn't encrypted, just authenticated — it must be re-supplied on
decrypt or decryption fails.

### `decryptEnvelope({ key, ciphertext, nonce, aad? })`

Returns plaintext bytes. Throws `DecryptionFailed` for any cause —
wrong key, tampered ciphertext, wrong AAD, wrong IV. The failure is
deliberately not differentiated.

### `formatKeyDerivationMessage({ purpose, version })`

Returns the EXACT plaintext the wallet will sign. Exposed so
consumers can preview it (e.g. show the user what's about to be
signed) or use the same template for offline test fixtures.

## Errors

All three are `instanceof`-checkable:

| Class | When |
|---|---|
| `WalletDeclined` | User rejected the signature prompt (EIP-1193 4001 / class / message). |
| `WalletUnavailable` | `WalletClient` has no `account` set. |
| `DecryptionFailed` | AEAD failure — wrong key, tamper, AAD mismatch, or IV mismatch. |

## End-to-end example

```ts
import { createWalletClient, custom } from 'viem'
import { mainnet } from 'viem/chains'
import {
  deriveWalletEncryptionKey,
  encryptEnvelope,
  decryptEnvelope,
} from '@valve-tech/wallet-crypto'

const walletClient = createWalletClient({
  chain: mainnet,
  transport: custom(window.ethereum),
})

// One-time per session, after wallet connect:
const key = await deriveWalletEncryptionKey({
  signer: walletClient,
  purpose: 'explore-workspaces',
  version: 1,
})

// Encrypt
const blob = JSON.stringify({ workspaces: [...] })
const { ciphertext, nonce } = await encryptEnvelope({
  key,
  plaintext: new TextEncoder().encode(blob),
  aad: new TextEncoder().encode('envelope-v1'),
})

// Send to backend (or IDB, S3, IPFS — your call)
await fetch('/api/sync', {
  method: 'PUT',
  body: JSON.stringify({
    ciphertext: btoa(String.fromCharCode(...ciphertext)),
    nonce: btoa(String.fromCharCode(...nonce)),
    envelope: 'v1',
  }),
})

// Decrypt later (same wallet, different device)
const decrypted = await decryptEnvelope({ key, ciphertext, nonce, aad: new TextEncoder().encode('envelope-v1') })
console.log(new TextDecoder().decode(decrypted))
```

## Pitfalls

1. **`nonce` in `encryptEnvelope`/`decryptEnvelope` is NOT an auth
   nonce.** It's the AES-GCM IV. The auth nonce from
   `@valve-tech/auth-lite` is unrelated. Crossing them is the #1
   reported caller error.

2. **Don't roll your own key derivation.** A `sha256(walletAddress +
   "my-app")`-style scheme is publicly recoverable — any other app
   can derive the same key. The `personal_sign` step in this package
   is what makes the key wallet-private, because only the wallet can
   produce the signature.

3. **Don't `console.log` the result of `signer.signMessage`.** The
   raw signature is the key seed; logging it leaks the encryption key.
   This package never returns or surfaces the signature; if you call
   `signMessage` yourself elsewhere with the same template, you're
   creating a new copy that can leak.

4. **AAD must match exactly on decrypt.** This is a feature (downgrade
   resistance) but a footgun if you forget. Treat AAD as part of the
   ciphertext-envelope shape and version it alongside.

5. **`version` bumps invalidate prior blobs.** Either migrate at
   bump-time or version-tag your stored blobs so you can read v1 with
   the v1 key and v2 with the v2 key.

## Composition with sibling packages

- **`@valve-tech/auth-lite`** — separate package for SIWE-lite auth.
  The two share `WalletDeclined`/`WalletUnavailable` error class
  names so consumers can `catch (e)` once.
- **`@valve-tech/viem-errors`** — `WalletDeclined` is thrown via
  this package's `isUserRejectionError` detector under the hood, so
  you get the same three-signal coverage (EIP-1193 4001, class name,
  message regex) without extra work.

## License

MIT
