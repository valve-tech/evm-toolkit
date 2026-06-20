# AGENTS.md

Terse reference for AI agents integrating `@valve-tech/siwe-store`.

## What this package does

Owns SIWE **server state**: the single-use/TTL nonce store and the
opaque session store. It does NOT do SIWE crypto/message/validation —
that's `viem/siwe`. Ships interfaces + in-memory defaults only.

## Public API

```ts
import {
  createMemoryNonceStore,    // (opts?: { ttlSeconds?: number }) => NonceStore
  createMemorySessionStore,  // (opts?: { ttlMs?: number }) => SessionStore
} from '@valve-tech/siwe-store'
import type { NonceStore, SessionStore, Session } from '@valve-tech/siwe-store'

// NonceStore:   issue(): string ; consume(nonce): boolean   (single-use, delete-before-TTL)
// SessionStore: issue(address, claims?): string ; validate(token): Session | null ; revoke(token): void
// Session:      { address: Address; issuedAt: number; claims?: Record<string, unknown> }
```

## Invariants (load-bearing)

1. **Single-use nonce.** `consume()` returns true at most once per
   nonce; it deletes BEFORE the TTL check so a race-loser cannot reuse.
2. **Opaque session token.** A CSPRNG `randomBytes(32)` base64url
   string. It carries no signed state; the binding is server-side.
3. **Interfaces are the contract.** Redis/SQL backends implement
   `NonceStore` / `SessionStore`; only the in-memory adapters ship.
   In-memory stores reset on restart — not for multi-instance prod.

## The verify recipe (with viem/siwe)

```
parseSiweMessage(message) → fields
nonceStore.consume(fields.nonce)            // single-use / replay
fields.version/uri/chainId === config       // pin fields viem does NOT check
validateSiweMessage({ message: fields, domain })  // domain binding + time validity
recoverMessageAddress({ message, signature }) === fields.address  // crypto
sessionStore.issue(fields.address)          // on success
// any failure → uniform 401
```

`validateSiweMessage` checks `domain`, time validity, and address
presence — but NOT `uri`, `chainId`, or `version`. Re-assert those
against server config explicitly (EIP-4361: check parsed fields
"against expected values").

Do NOT pass `nonce` to `validateSiweMessage` — issuance/single-use is
the store's job, not a string-equality re-check.

## Skills

`skills/siwe-store-integration/SKILL.md` ships in the tarball.
