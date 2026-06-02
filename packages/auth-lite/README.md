# `@valve-tech/auth-lite`

SIWE-lite authentication for viem-based dapps. Server-issued nonce →
client `personal_sign` → server recover. Deliberately narrower than
full EIP-4361 — see [Why not full SIWE](#why-not-full-siwe).

Pure functions. No nonce storage. No session token issuance. Pairs
with `@valve-tech/wallet-crypto` if you also need wallet-derived
encryption.

```bash
npm install @valve-tech/auth-lite viem
```

## Why not full SIWE

EIP-4361's structured fields (Domain, URI, Chain ID, Statement,
Resources, Issued At, Expiration) exist to defend against cross-site
signature replay between unrelated dapps. If you're a single-app
product, that threat model is overkill — a server-issued single-use
nonce already covers replay. Stripping the optional fields gives you:

- Smaller signed plaintext → cleaner wallet UI.
- Simpler spec → easier to audit.
- One signing template per app → no field-ordering footguns.

Use full SIWE when you need cross-app session portability (e.g. an
attestation a third party can verify). For everything else, this
package is the right call.

## API

```ts
import {
  // Client
  signAuthChallenge,
  // Server
  generateAuthNonce,
  verifyAuthSignature,
  // Shared
  formatAuthMessage,
  AUTH_MESSAGE_TEMPLATE,
  // Errors
  WalletDeclined,
  WalletUnavailable,
  InvalidNonce,
  SignatureMismatch,
} from '@valve-tech/auth-lite'
```

### Server: `generateAuthNonce({ bytes?, ttlSeconds? })`

```ts
const { nonce, expiresAt } = generateAuthNonce()
// nonce: base64url string (32 bytes / 43 chars by default)
// expiresAt: ms-epoch timestamp
```

Bounds: `bytes` ∈ [16, 64] (default 32), `ttlSeconds` ∈ [30, 3600]
(default 300). The caller MUST persist the nonce in an issued-but-
unused set and delete it on successful verify (single-use enforcement
is the caller's responsibility — this package is stateless).

### Server: `verifyAuthSignature({ app, nonce, signature, claimedAddress })`

```ts
const recovered = await verifyAuthSignature({
  app: 'Explore',
  nonce: storedNonce,
  signature: req.body.signature,
  claimedAddress: req.body.address,
})
if (!recovered) return res.status(401).end()
```

Returns the recovered `Address` on success, `null` on any failure
(bad signature, address mismatch, malformed input). The single-null
return prevents the verify endpoint from leaking *which* check failed
to an attacker.

**`app` MUST come from trusted server context** — environment
config, route handler constant, etc. Pulling it from the request body
lets an attacker rebind a signature to a different `app`.

### Client: `signAuthChallenge({ signer, app, nonce })`

```ts
const { address, signature, message } = await signAuthChallenge({
  signer: walletClient,
  app: 'Explore',
  nonce: serverNonce,
})
await fetch('/auth/verify', {
  method: 'POST',
  body: JSON.stringify({ address, signature, nonce: serverNonce }),
})
```

Throws:
- `InvalidNonce` — nonce isn't base64url with ≥16 raw bytes.
- `WalletDeclined` — user rejected the prompt.
- `WalletUnavailable` — `WalletClient` has no account.

### Shared: `formatAuthMessage({ app, nonce })`

The exact plaintext both sides format. Exposed so consumers can
preview it in their UI ("about to sign:" copy) and so test fixtures
can use the same source of truth.

## End-to-end

```ts
// --- server ---
import express from 'express'
import { generateAuthNonce, verifyAuthSignature } from '@valve-tech/auth-lite'

const nonces = new Map<string, { expiresAt: number }>() // dev only — use Redis in prod

app.get('/auth/nonce', (_req, res) => {
  const { nonce, expiresAt } = generateAuthNonce()
  nonces.set(nonce, { expiresAt })
  res.json({ nonce })
})

app.post('/auth/verify', async (req, res) => {
  const { nonce, signature, address } = req.body
  const stored = nonces.get(nonce)
  if (!stored || stored.expiresAt < Date.now()) return res.status(401).end()
  nonces.delete(nonce) // single-use

  const recovered = await verifyAuthSignature({
    app: 'Explore',
    nonce,
    signature,
    claimedAddress: address,
  })
  if (!recovered) return res.status(401).end()

  const sessionToken = issueSession(recovered) // your session lib
  res.json({ sessionToken })
})

// --- client ---
import { createWalletClient, custom } from 'viem'
import { mainnet } from 'viem/chains'
import { signAuthChallenge } from '@valve-tech/auth-lite'

const walletClient = createWalletClient({
  chain: mainnet,
  transport: custom(window.ethereum),
})

const { nonce } = await fetch('/auth/nonce').then(r => r.json())
const { address, signature } = await signAuthChallenge({
  signer: walletClient,
  app: 'Explore',
  nonce,
})
const { sessionToken } = await fetch('/auth/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ nonce, signature, address }),
}).then(r => r.json())
```

## Errors

| Class | Side | When |
|---|---|---|
| `WalletDeclined` | Client | User rejected the wallet prompt. |
| `WalletUnavailable` | Client | `WalletClient` has no account. |
| `InvalidNonce` | Client | Nonce sanity-check failed (empty, too short, non-base64url). |
| `SignatureMismatch` | Server | (reserved — currently `verifyAuthSignature` returns `null` instead of throwing this; export retained for future strict-mode option.) |

## Pitfalls

1. **`verifyAuthSignature` does NOT check nonce single-use or
   expiry.** That's your storage layer's job. Always:
   - Look the nonce up in your issued-but-unused store.
   - Check `expiresAt > now`.
   - Delete on success.

2. **`app` for verify MUST come from trusted server config**, not the
   request body. Otherwise an attacker can take a signature for
   `app: "real"` and verify it as `app: "real"` while sending a body
   that claims `app: "evil"` — but this isn't the failure mode.
   The failure is: if you let request-body `app` flow to the verify
   call, you've lost cross-app rejection entirely.

3. **The nonce in this package is NOT the AES-GCM nonce from
   `@valve-tech/wallet-crypto`'s envelope.** Unrelated; same word.
   Don't pass one where the other is expected.

4. **Don't put the nonce in the URL.** Nonces are sensitive (until
   consumed) and URLs land in server access logs. Put it in the
   response body for `/auth/nonce` and the request body for
   `/auth/verify`.

5. **Don't reuse a nonce across sessions.** That's the entire point
   of single-use; if your store leaks an issued-but-unused nonce, an
   attacker who has a stale signature can replay it.

## Composition

- **`@valve-tech/wallet-crypto`** — pair when you need both auth and
  encrypted cloud sync. Shared `WalletDeclined`/`WalletUnavailable`
  class names mean you can `catch (e)` once.
- **`@valve-tech/viem-errors`** — used internally for the
  `WalletDeclined` rejection detection. You don't need to import it
  directly.

## License

MIT
