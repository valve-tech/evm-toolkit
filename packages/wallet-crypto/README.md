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
  rotateEnvelope,
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

1. App derives the v1 (old) and v2 (new) keys — two signatures total,
   whatever the blob count.
2. For each stored blob, `rotateEnvelope({ oldKey, newKey, ... })`
   re-wraps it (see below), and the app writes the result back.
3. App updates its persisted "current version" flag.

The library owns deriving distinct keys per version and re-wrapping a
single envelope; the app owns reading/writing its own storage and the
"current version" flag.

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

### `rotateEnvelope({ oldKey, newKey, ciphertext, nonce, oldAad?, newAad? })`

Returns a fresh `{ ciphertext, nonce }` re-encrypted under `newKey` —
the per-blob step of a key rotation. Exactly `decryptEnvelope(oldKey)`
then `encryptEnvelope(newKey)`, in one call so the plaintext is never
handed back and the AAD swap (`oldAad` → `newAad`, commonly the old and
new version tags) is explicit. A fresh IV is generated, so the result
is unrelated to the input.

```ts
const oldKey = await deriveWalletEncryptionKey({ signer, purpose, version: 1 })
const newKey = await deriveWalletEncryptionKey({ signer, purpose, version: 2 })
for (const blob of storedBlobs) {
  const rotated = await rotateEnvelope({
    oldKey,
    newKey,
    ciphertext: blob.ciphertext,
    nonce: blob.nonce,
  })
  await store.put(blob.id, rotated)
}
```

Throws `DecryptionFailed` if `oldKey`, `nonce`, or `oldAad` don't match
the input envelope. Because it returns nothing to write on failure, a
failed rotation leaves the caller's stored ciphertext untouched.

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
   nonce.** It's the AES-GCM IV. The SIWE nonce from
   `viem/siwe` / `@valve-tech/siwe-store` is unrelated. Crossing them is the #1
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

- **`@valve-tech/wallet-key-session`** — the memory-only lifecycle of
  the key this package derives (derive-once, wipe on account-change /
  tab-close). Wire `deriveWalletEncryptionKey` into its `derive`
  callback. For auth, use `viem/siwe` + `@valve-tech/siwe-store`.
- **`@valve-tech/viem-errors`** — `WalletDeclined` is thrown via
  this package's `isUserRejectionError` detector under the hood, so
  you get the same three-signal coverage (EIP-1193 4001, class name,
  message regex) without extra work.

## For AI agents

Machine-readable integration skills ship in this tarball under
`skills/`. Run `npx @valve-tech/agent-skills install` to copy all
installed `@valve-tech/*` skills into `.claude/skills/`, or read them
in place at `node_modules/@valve-tech/wallet-crypto/skills/`.

## License

MIT
