# AGENTS.md

Terse reference for AI agents (Claude Code, Cursor, Aider) integrating
`@valve-tech/auth-lite`. Full README is for humans; this file is for
agents that need the package's actual surface fast.

## What this package does

SIWE-lite authentication: server-issued nonce → client `personal_sign`
→ server `recoverMessageAddress`. Plain text wallet prompt, single-app
threat model, no domain/URI/chainId/issuedAt bookkeeping. Pure
functions; the caller owns nonce storage and session token issuance.

Peer-deps `viem`. Uses `@valve-tech/viem-errors` for rejection
detection. Pairs with `@valve-tech/wallet-crypto` for products that
also need wallet-derived encryption.

## Public API

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

## Decision tree

```
Where is the user wiring this in?
├── Client-side (browser, has WalletClient)
│   └── signAuthChallenge({ signer, app, nonce })
│       → returns { address, signature, message }
│       → POST to /auth/verify
└── Server-side
    ├── /auth/nonce handler
    │   └── generateAuthNonce({ bytes?, ttlSeconds? })
    │       → returns { nonce, expiresAt }
    │       → PERSIST { nonce, expiresAt } in your store
    │       → respond { nonce } to client
    └── /auth/verify handler
        └── Look up nonce in store, check expiresAt, delete on hit
        └── verifyAuthSignature({ app, nonce, signature, claimedAddress })
            → returns Address on success, null on any failure
            → Issue your session token (NOT done by this package)
```

## The 5 invariants

1. **Nonce single-use is the CALLER's job.** This package generates
   nonces but doesn't store them. The caller MUST:
   - Persist on issue.
   - Look up + delete on verify (atomic if possible).
   - Reject expired nonces (consult `expiresAt`).

2. **`app` for verify MUST come from trusted server context.** If
   the request body controls `app`, cross-app rejection is gone.
   Convention: `const APP = process.env.APP_NAME ?? 'Explore'` at
   module scope.

3. **`verifyAuthSignature` returns null, doesn't throw.** Single-null
   on failure is the AEAD-equivalent for auth: don't leak which check
   failed. Callers write `if (!recovered) return 401` not
   `try/catch`.

4. **Nonce structural sanity is client-side only.** The client throws
   `InvalidNonce` on malformed input as a safety net. Server-side
   validates structurally via base64url decode if it wants, but the
   true validation is "is this in my issued set" — structural shape
   is incidental.

5. **The signed plaintext is the contract.** `formatAuthMessage`
   produces byte-identical output for the same (app, nonce) on both
   sides. Don't reinvent the template; both sides use the same
   function from this package.

## Common situations

### "I want to add SIWE auth to my dapp"

→ Use this package, NOT a hand-rolled or full-SIWE setup. Wire:
- Server: `/auth/nonce` calls `generateAuthNonce`, stores result,
  returns `nonce`.
- Server: `/auth/verify` looks up nonce, calls
  `verifyAuthSignature`, issues your session.
- Client: `signAuthChallenge` between the two fetches.

### "Should I use this or full SIWE?"

This package is single-app. Use full SIWE only when you need
cross-app session portability (e.g. an attested credential that a
third-party site verifies). For 99% of "let users sign in with their
wallet" use cases, this is the right call.

### "Where should I store nonces?"

Anywhere with TTL + single-use semantics:
- Production: Redis `SETEX nonce:<n> <ttlSec> "1"`, then
  `GETDEL nonce:<n>` on verify.
- Edge/serverless: Cloudflare KV with `expirationTtl`.
- Tiny apps: `Map<string, { expiresAt: number }>` is fine for dev/single-
  instance.

This package doesn't ship an adapter — the storage is too thin to
justify one.

### "Should I sign a JWT after verifyAuthSignature succeeds?"

That's your session-issuance layer. This package returns the
recovered address; you decide JWT vs. opaque cookie vs. server-side
session row. If you need a quick default, `jose` for JWTs is the
standard 2026 pick.

### "How do I handle the WalletDeclined case?"

Reset UI to idle. Don't show an error toast — the user explicitly
cancelled. The class-name distinction makes the catch arm clean:

```ts
try {
  await signAuthChallenge(...)
} catch (err) {
  if (err instanceof WalletDeclined) { setStatus('idle'); return }
  if (err instanceof InvalidNonce) { throw new Error('server bug') }
  throw err
}
```

## Pitfalls (flag these in user code)

1. **`app` flowing from request body to `verifyAuthSignature`.**
   The verify endpoint MUST take `app` from server config. If the
   user's code does `const { app, nonce, signature, address } =
   req.body; verifyAuthSignature({ app, ... })`, that's a bug.

2. **Single-use enforcement missing.** If the user's verify endpoint
   doesn't `delete` the nonce on success, an attacker who steals the
   signature can replay it. Always atomic-delete on lookup.

3. **TTL not enforced.** If the user persists `{ nonce }` without
   checking `expiresAt < now` on verify, stale nonces persist past
   their window. Either store with native TTL (Redis SETEX,
   CF KV expirationTtl) OR explicitly compare.

4. **Confusing the nonce with the AES-GCM nonce in
   `@valve-tech/wallet-crypto`'s envelope.** Different concept, same
   word. Flag this any time you see them in the same file.

5. **Reusing the signed message for something else.** The plaintext
   contains "does NOT authorize any transaction or transfer" for a
   reason. Don't use the signature as a delegated-auth token for
   real transactions — it isn't one.

6. **Storing the nonce in a cookie or URL.** Nonces should live in
   server-side storage only. Putting them in URLs sends them to
   access logs; putting them in cookies makes them per-browser when
   they should be per-issuance.

## Composition

- **`@valve-tech/wallet-crypto`** — pair for products that also do
  encrypted cloud sync. Shared `WalletDeclined`/`WalletUnavailable`
  class names.
- **`@valve-tech/viem-errors`** — used internally; you don't need it
  directly.

## Skills

`skills/auth-lite-integration/SKILL.md` ships in the npm tarball for
AI agents in consumer projects.

## Verifying provenance

```bash
npm view @valve-tech/auth-lite@latest --json | jq .dist.attestations
npm audit signatures
```
