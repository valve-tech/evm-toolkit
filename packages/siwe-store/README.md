# @valve-tech/siwe-store

The server-side **state** for Sign-In with Ethereum that
[`viem/siwe`](https://viem.sh/docs/siwe) deliberately leaves to the
app: a **single-use, TTL'd nonce store** (the replay defense) and an
**opaque session store** (the "still logged in" state).

`viem/siwe` owns the crypto, the EIP-4361 message, and validation.
This package owns the two stateful pieces it can't: atomic nonce
consumption and session issuance.

## Install

```bash
npm install @valve-tech/siwe-store viem
```

## Use

```ts
import { createMemoryNonceStore, createMemorySessionStore } from '@valve-tech/siwe-store'
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import { recoverMessageAddress, isAddressEqual } from 'viem'

const nonces = createMemoryNonceStore()
const sessions = createMemorySessionStore()

// GET /auth/challenge
const message = createSiweMessage({
  address, chainId, domain, uri, version: '1', nonce: nonces.issue(), statement,
})

// POST /auth/verify  { message, signature }
const fields = parseSiweMessage(message)
if (!fields.nonce || !nonces.consume(fields.nonce)) throw new Error('replay')
// Re-assert binding fields validateSiweMessage does NOT check (uri, chainId, version):
if (fields.version !== '1' || fields.uri !== uri || fields.chainId !== chainId) throw new Error('bad message')
if (!validateSiweMessage({ message: fields, domain })) throw new Error('bad domain/time')
const recovered = await recoverMessageAddress({ message, signature })
if (!fields.address || !isAddressEqual(recovered, fields.address)) throw new Error('bad sig')
const token = sessions.issue(fields.address)
```

## Interfaces vs. adapters

This package ships the `NonceStore` / `SessionStore` **interfaces**
(the contract for Redis/SQL/cookie backends) plus **in-memory
defaults**. The in-memory stores are single-instance and reset on
restart — for multi-instance production state, implement the
interfaces over Redis, or reach for [iron-session] / [NextAuth]. This
package intentionally ships no such adapter.

[iron-session]: https://github.com/vvo/iron-session
[NextAuth]: https://authjs.dev

## Part of the toolkit

`@valve-tech/siwe-store` ships on the
[valve-tech/evm-toolkit](https://github.com/valve-tech/evm-toolkit)
synchronized release line. Pairs with `viem/siwe` (crypto/message/
validation) and, on the client, `@valve-tech/wallet-key-session`.
