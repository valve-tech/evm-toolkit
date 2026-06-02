/**
 * 01 — Full sign-in flow, in-process.
 *
 * Runs both sides in one script for clarity. In a real deployment,
 * the "server" side runs in your API and the "client" side runs in
 * the browser; they communicate via fetch().
 *
 * Run with: yarn tsx packages/auth-lite/examples/01-sign-in-flow.ts
 */

import { createWalletClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import {
  generateAuthNonce,
  signAuthChallenge,
  verifyAuthSignature,
} from '../src/index.js'

const APP = 'Explore'

// --- Server: dev-only in-memory nonce store. In production, use
// Redis SETEX + GETDEL, Cloudflare KV with expirationTtl, or
// Postgres with a TTL job.
const nonces = new Map<string, { expiresAt: number }>()

function serverIssueNonce() {
  const { nonce, expiresAt } = generateAuthNonce()
  nonces.set(nonce, { expiresAt })
  return { nonce }
}

async function serverVerify(input: { nonce: string; signature: `0x${string}`; address: `0x${string}` }) {
  const stored = nonces.get(input.nonce)
  if (!stored) return { ok: false, reason: 'unknown nonce' as const }
  if (stored.expiresAt < Date.now()) {
    nonces.delete(input.nonce)
    return { ok: false, reason: 'expired' as const }
  }
  // Atomic-ish delete BEFORE the recover so a race-loser can't reuse.
  nonces.delete(input.nonce)

  // CRITICAL: `app` comes from server config, NOT request body.
  const recovered = await verifyAuthSignature({
    app: APP,
    nonce: input.nonce,
    signature: input.signature,
    claimedAddress: input.address,
  })
  if (!recovered) return { ok: false, reason: 'invalid signature' as const }
  return { ok: true, address: recovered }
}

// --- Client: viem WalletClient. Use a privateKeyAccount for this
// self-contained script; in browser, swap for custom(window.ethereum).
const account = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)
const walletClient = createWalletClient({ account, chain: mainnet, transport: http() })

// 1. Client requests a nonce from server.
const { nonce } = serverIssueNonce()
console.log('server issued nonce:', nonce.slice(0, 12) + '...')

// 2. Client signs the challenge.
const { address, signature } = await signAuthChallenge({
  signer: walletClient,
  app: APP,
  nonce,
})
console.log('client signed; address:', address)

// 3. Client posts {nonce, signature, address} to server.
const verifyResult = await serverVerify({ nonce, signature, address })
console.log('verify result:', verifyResult)

// 4. (Optional) replay attempt with the same nonce — should fail.
const replay = await serverVerify({ nonce, signature, address })
console.log('replay attempt (should be unknown nonce):', replay)

// 5. (Optional) attacker tries different app — server APP is config,
//    so the user's correct sig won't recover to the claimed address
//    when the server uses a different APP value.
const attackerNonce = serverIssueNonce().nonce
const attackerSig = await signAuthChallenge({
  signer: walletClient,
  app: 'EvilApp', // attacker signs for a different app
  nonce: attackerNonce,
})
const crossApp = await serverVerify({
  nonce: attackerNonce,
  signature: attackerSig.signature,
  address: attackerSig.address,
})
console.log('cross-app attack (should be invalid signature):', crossApp)
