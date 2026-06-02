/**
 * @fileoverview Server-side signature verification.
 *
 * Returns the recovered address if the signature is valid AND it
 * matches the caller's `claimedAddress`; null otherwise. The single
 * "null" return on failure is deliberate — the caller MUST NOT know
 * (and therefore cannot leak to an attacker) whether the failure was
 * a bad signature vs. an address mismatch vs. a malformed input.
 *
 * Caller still owns:
 * - Nonce single-use enforcement (consult/delete from your store).
 * - Nonce TTL enforcement (the expiresAt from generateAuthNonce).
 * - App-identity verification (typically derived from your request
 *   handler's known app value, NOT from the request body).
 *
 * This function is the cryptographic step only.
 */

import type { Address, Hex } from 'viem'
import { recoverMessageAddress, isAddressEqual } from 'viem'
import { formatAuthMessage } from './messages.js'

/**
 * Verify a signed auth challenge.
 *
 * @param opts.app - The expected app identifier. MUST come from
 *   trusted server context (e.g. environment config), NOT the request
 *   body — otherwise an attacker can rebind a signature to a different
 *   app by submitting a different `app` value.
 * @param opts.nonce - The challenge nonce. Caller should have already
 *   confirmed it's in the issued-but-unused set and not expired.
 * @param opts.signature - The signature from
 *   {@link signAuthChallenge}.
 * @param opts.claimedAddress - The address the client claims signed
 *   it. Cheap pre-check before the expensive ECDSA recover; ALSO
 *   catches the case where a frontend mis-echoes the signer (a real
 *   UX bug).
 *
 * @returns The recovered address on success, `null` on any failure
 *   (bad signature, address mismatch, malformed input).
 */
export async function verifyAuthSignature(opts: {
  app: string
  nonce: string
  signature: Hex
  claimedAddress: Address
}): Promise<Address | null> {
  const message = formatAuthMessage({ app: opts.app, nonce: opts.nonce })

  // Best-effort constant-time-flavored failure path: we wrap the whole
  // thing in try/catch and return null uniformly. The actual ECDSA
  // recover is not strictly constant-time in viem (it's implemented in
  // JS atop noble-curves, which is reasonably hardened) but the
  // observable behavior to the caller — and therefore to a remote
  // attacker — is a single "null" with no message text variance.
  let recovered: Address
  try {
    recovered = await recoverMessageAddress({ message, signature: opts.signature })
  } catch {
    return null
  }

  if (!isAddressEqual(recovered, opts.claimedAddress)) {
    return null
  }

  return recovered
}
