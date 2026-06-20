/**
 * 01 — The server-side SIWE state stores.
 *
 * The nonce store is the replay defense (single-use); the session
 * store is the "still logged in" state (opaque token → address).
 * `viem/siwe` does the crypto/message/validation in between — see the
 * encrypted-vault example for the full GET /auth/challenge →
 * POST /auth/verify wiring.
 *
 * Run with: yarn tsx packages/siwe-store/examples/01-nonce-and-session.ts
 */

import { createMemoryNonceStore, createMemorySessionStore } from '../src/index.js'

const nonces = createMemoryNonceStore()
const sessions = createMemorySessionStore()

const nonce = nonces.issue()
console.log('issued nonce:', nonce)
console.log('first consume :', nonces.consume(nonce)) // true
console.log('replay consume:', nonces.consume(nonce)) // false — single-use

const address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const
const token = sessions.issue(address, { plan: 'demo' })
console.log('session:', sessions.validate(token)) // { address, issuedAt, claims: { plan: 'demo' } }
sessions.revoke(token)
console.log('after revoke:', sessions.validate(token)) // null
