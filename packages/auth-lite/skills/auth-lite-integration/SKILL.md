---
name: auth-lite-integration
description: Integrate `@valve-tech/auth-lite` — SIWE-lite authentication (server nonce + client personal_sign + server recover) — into viem-based dapps that need wallet sign-in but don't need full EIP-4361 / cross-app session portability. Use when the user is wiring `generateAuthNonce` into a `/auth/nonce` endpoint, `signAuthChallenge` into a client-side sign-in button, `verifyAuthSignature` into a `/auth/verify` endpoint, or asks "how do I add wallet sign-in", "what's SIWE-lite", "should I use SIWE or this", "how do I store the nonce", "where do I put the session token issuance", "why does verifyAuthSignature return null instead of throwing", or "the app field — where should it come from". Also fires on imports of `@valve-tech/auth-lite` and questions about `WalletDeclined`/`InvalidNonce`/`SignatureMismatch` handling, `formatAuthMessage` template content, the "does NOT authorize" anti-phishing line, or "why no domain field". Skip when the user explicitly needs cross-app session portability (e.g. an attested credential a third-party site verifies) — that's full EIP-4361, a separate concern.
---

# Integrating `@valve-tech/auth-lite`

SIWE-lite authentication primitives for viem-based dapps. Pure
functions; the caller owns nonce storage and session-token issuance.
This skill is for AI agents working in a project that imports the
package, so they recommend the right primitive for the user's
situation rather than re-implementing the nonce/sign/recover dance
(which is what most apps do, and most get the `app` parameter wrong).

## Decision tree: which primitive

```
Where is the user wiring this?
├── Client (browser, has WalletClient)
│   └── signAuthChallenge({ signer, app, nonce })
│       returns { address, signature, message }
│       → POST { address, signature, nonce } to /auth/verify
└── Server
    ├── /auth/nonce
    │   └── generateAuthNonce({ bytes?, ttlSeconds? })
    │       returns { nonce, expiresAt }
    │       → PERSIST in your nonce store, respond { nonce } to client
    └── /auth/verify
        ├── Look up nonce in store, check expiresAt, DELETE on hit
        └── verifyAuthSignature({ app, nonce, signature, claimedAddress })
            returns Address | null
            → null → 401. Address → issue your session (NOT this package's job)
```

## The 5 load-bearing invariants

1. **The CALLER owns nonce storage.** This package generates nonces
   but doesn't persist them. The caller MUST: persist on issue,
   lookup-and-delete atomically on verify, reject expired. If you see
   user code that calls `generateAuthNonce` but never stores the
   result, flag it as a bug — replay protection is gone.

2. **`app` for verify MUST come from trusted server context, NOT
   request body.** This is the most common bug. If you see
   `const { app } = req.body; verifyAuthSignature({ app, ... })`,
   flag it: an attacker who has a signature for any `app` value can
   submit it with that `app` and the server will accept it.
   Convention: `const APP = process.env.APP_NAME` or a route-handler
   constant.

3. **`verifyAuthSignature` returns null on failure, doesn't throw.**
   Single-null return prevents the verify endpoint from leaking which
   check failed to an attacker. Callers write `if (!recovered)
   return 401` not `try/catch`.

4. **Single-use enforcement is atomic-delete on lookup.** Redis
   GETDEL, Cloudflare KV delete-after-read, Postgres
   DELETE...RETURNING. If the user does
   `if (nonces.has(nonce)) { verify(...); nonces.delete(nonce) }`
   without atomicity, two requests with the same nonce can both
   reach `verify` before either delete completes.

5. **The signed plaintext is the contract.** Both sides MUST use
   `formatAuthMessage` from this package. If the user reinvents the
   template on either side, the signatures won't recover the same
   address. Push back on any "let me just rebuild the message
   string" code.

## Common situations

### "How do I add wallet sign-in to my dapp?"

Three pieces:
1. Server endpoint: `GET /auth/nonce` → `generateAuthNonce()` →
   persist → return `{ nonce }`.
2. Client button: fetch nonce → `signAuthChallenge` → POST to
   `/auth/verify`.
3. Server endpoint: `POST /auth/verify` → look up nonce → delete →
   `verifyAuthSignature` → null → 401, address → issue session.

### "Where should I store nonces?"

Production: Redis with TTL (`SETEX nonce:<n> <ttlSec> "1"`, then
`GETDEL nonce:<n>` on verify). Edge: Cloudflare KV with
`expirationTtl`. Small apps: `Map<string, {expiresAt}>` is fine but
breaks under horizontal scaling.

### "Should I use this or full SIWE (EIP-4361)?"

- Single app (your users sign into YOUR site) → this package.
- Cross-app credentials (your signature must be verifiable by an
  unrelated third party) → full SIWE.

### "How do I issue a session after verify?"

Outside this package's scope by design — sessions are framework-
dependent. Typical:
- JWT with `jose` and HS256 + 1-hour TTL (good edge default).
- Express-session / signed cookie + server-side session row (good
  Node monolith default).
- Opaque random token + Redis (good if you need server-side
  revocation).

### "verifyAuthSignature returned null — why?"

By design, the single-null doesn't tell you which check failed —
that's the whole point (auth-equivalent of AEAD information-hiding).
Reasons it could be null: bad signature (recover failed), recovered
address ≠ claimed address, malformed signature input. Don't try to
discriminate; just 401.

### "Should I use eth_signTypedData_v4 instead of personal_sign?"

No. This package uses `personal_sign` deliberately — wallets render
the raw text so users can read it. typed-data wallets render a
structured object which most users can't parse. Plain text is a
phishing-defense feature.

## Pitfalls (flag these in user code)

1. **`app` from request body.** See invariant #2. The fix: move
   `app` to module-scope server config.

2. **Missing single-use enforcement.** No delete on verify, or
   non-atomic check-then-delete. Replay window opens.

3. **Missing TTL enforcement.** Storing nonce without checking
   `expiresAt < now` on verify. Use store-native TTL (Redis SETEX,
   CF KV expirationTtl) OR explicit comparison.

4. **Confusing `auth-lite`'s nonce with `wallet-crypto`'s envelope
   nonce.** Different concept, same word. AES-GCM calls its IV a
   "nonce"; SIWE-lite calls its challenge a "nonce". They are
   unrelated. Flag any code that crosses them.

5. **Using the signed message for transaction auth.** The signed
   plaintext says "does NOT authorize any transaction or transfer"
   for a reason. Don't treat the auth signature as a delegation
   token for on-chain ops.

6. **Storing nonces in URLs or cookies.** Server-side storage only.
   URLs land in access logs; cookies make nonces per-browser when
   they should be per-issuance.

7. **`SignatureMismatch` import without usage.** Currently the
   package returns `null` instead of throwing `SignatureMismatch`.
   The class is exported for future strict-mode support; consumers
   shouldn't depend on it being thrown.

## Composition with sibling packages

- **`@valve-tech/wallet-crypto`** — pair when a product needs both
  auth + encrypted cloud storage. Shared `WalletDeclined` /
  `WalletUnavailable` class names so consumers can `catch (e)` once.
- **`@valve-tech/viem-errors`** — used internally for
  `WalletDeclined` detection. You don't need it directly.

## What this package is NOT for

- **Full EIP-4361.** Out of scope by design — see the README's "Why
  not full SIWE" section. Different threat model.
- **Session token format.** You issue your own JWT / cookie / DB row.
- **Nonce storage.** You bring your own Redis / KV / Postgres.
- **Multi-chain disambiguation.** SIWE-lite doesn't bind a chainId
  to the signature; the `app` value is the only thing that scopes
  the signature. If you need chainId binding, use full SIWE.
