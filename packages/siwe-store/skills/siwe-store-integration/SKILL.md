---
name: siwe-store-integration
description: Integrate `@valve-tech/siwe-store` — the server-side state for Sign-In with Ethereum (SIWE / EIP-4361) — alongside `viem/siwe`. Use when calling `createMemoryNonceStore` for single-use/TTL replay protection or `createMemorySessionStore` for opaque address-bound sessions, when wiring the `GET /auth/challenge` → `POST /auth/verify` flow with `createSiweMessage` / `parseSiweMessage` / `validateSiweMessage` / `recoverMessageAddress`, or when asked "how do I stop SIWE nonce replay", "where do I store the SIWE session", "viem/siwe doesn't persist the nonce — what do I use", or "how do I make this work across multiple server instances" (implement the interfaces over Redis). Skip when the user only needs the SIWE message/crypto — that's `viem/siwe` directly — or when they need the browser key lifecycle — that's `wallet-key-session-integration`.
---

# Integrating `@valve-tech/siwe-store`

`viem/siwe` owns the SIWE crypto, message, and validation. This package
owns the two stateful pieces it leaves to you: the single-use nonce
store and the opaque session store. Always pair the two.

## The full server flow

```ts
import { createMemoryNonceStore, createMemorySessionStore } from '@valve-tech/siwe-store'
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import { recoverMessageAddress, isAddressEqual, getAddress } from 'viem'

const nonces = createMemoryNonceStore()
const sessions = createMemorySessionStore()

// GET /auth/challenge?address=&chainId=  — domain/uri/chainId/statement from SERVER config
function challenge(address: string) {
  return createSiweMessage({
    address: getAddress(address),
    chainId: CHAIN_ID, domain: DOMAIN, uri: URI, version: '1',
    nonce: nonces.issue(), statement: STATEMENT,
    issuedAt: new Date(), expirationTime: new Date(Date.now() + 5 * 60_000),
  })
}

// POST /auth/verify  { message, signature }
async function verify(message: string, signature: `0x${string}`) {
  const fields = parseSiweMessage(message)
  if (!fields.nonce || !nonces.consume(fields.nonce)) return null   // single-use / replay
  if (!validateSiweMessage({ message, domain: DOMAIN })) return null // domain + time
  const recovered = await recoverMessageAddress({ message, signature })
  if (!fields.address || !isAddressEqual(recovered, fields.address)) return null
  return sessions.issue(fields.address)                              // opaque token
}
```

## Invariants to enforce in review

1. **Binding fields come from server config, never the request body.**
   `domain`, `uri`, `chainId`, `statement` are trusted server values.
   Taking `domain` from the request lets an attacker rebind a signature.
2. **`consume()` is the replay check — call it once.** Don't also pass
   `nonce` to `validateSiweMessage`; that's a circular string-equality
   re-check. Issuance + single-use is the store's job.
3. **Uniform failure.** Every verify failure path returns the same
   `401` — don't leak which check failed.
4. **In-memory = single instance.** For multi-instance deploys,
   implement `NonceStore` / `SessionStore` over Redis (or use
   iron-session / NextAuth). Flag any in-memory store behind a load
   balancer.

## Composition

- **`viem/siwe`** — the crypto/message/validation half. Mandatory pair.
- **`@valve-tech/wallet-key-session`** — the *client* key lifecycle, if
  the app also encrypts data to the wallet. Orthogonal to this package.
- **`building-apps-with-evm-toolkit`** — the seam-level recipe that
  wires login + wallet-encrypted data end to end.

## Where to find more

- API + types: `node_modules/@valve-tech/siwe-store/AGENTS.md`
- Human docs: `node_modules/@valve-tech/siwe-store/README.md`
- Runnable example of the full flow: the `encrypted-vault` example in
  the evm-toolkit repo.
