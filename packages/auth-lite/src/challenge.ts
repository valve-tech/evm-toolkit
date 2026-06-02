/**
 * @fileoverview Client-side: sign a server-issued auth nonce.
 *
 * Wraps `walletClient.signMessage` with:
 * - Nonce sanity check (≥16 raw bytes when base64url-decoded).
 * - WalletDeclined throw on rejection (via @valve-tech/viem-errors).
 * - Returns the address alongside the signature so the caller can
 *   POST both to /verify without an extra getAddresses() round trip.
 */

import type { WalletClient, Address, Hex } from 'viem'
import { isUserRejectionError } from '@valve-tech/viem-errors'
import { formatAuthMessage } from './messages.js'
import { WalletDeclined, WalletUnavailable, InvalidNonce } from './errors.js'

/** Minimum raw byte length the nonce must decode to. */
const MIN_NONCE_BYTES = 16

/**
 * Sign a server-issued auth challenge.
 *
 * Throws {@link InvalidNonce} if `nonce` isn't a base64url string
 * of ≥16 raw bytes — a structural sanity check that catches a server
 * bug returning `""` or a too-short challenge BEFORE we ask the user
 * to sign nothing.
 *
 * Throws {@link WalletDeclined} on EIP-1193 4001 / class-name /
 * message-regex rejection signals.
 *
 * Throws {@link WalletUnavailable} if the WalletClient has no account.
 */
export async function signAuthChallenge(opts: {
  signer: WalletClient
  /** App identifier shown in the wallet prompt. */
  app: string
  /** Server-issued nonce, base64url-encoded. */
  nonce: string
}): Promise<{ address: Address; signature: Hex; message: string }> {
  if (!isValidNonce(opts.nonce)) {
    throw new InvalidNonce(
      `Nonce must be base64url with ≥${MIN_NONCE_BYTES} raw bytes`,
    )
  }

  const account = opts.signer.account
  if (!account) {
    throw new WalletUnavailable()
  }

  const message = formatAuthMessage({ app: opts.app, nonce: opts.nonce })

  let signature: Hex
  try {
    signature = await opts.signer.signMessage({ account, message })
  } catch (err) {
    if (isUserRejectionError(err)) {
      throw new WalletDeclined()
    }
    throw err
  }

  return { address: account.address, signature, message }
}

/**
 * Structural sanity for a base64url-encoded nonce. We don't decode
 * fully here — just count significant chars and reject anything that
 * couldn't represent ≥MIN_NONCE_BYTES.
 *
 * base64url uses ~4 chars per 3 bytes, so n bytes ≥ ceil(4n/3) chars.
 * For MIN_NONCE_BYTES = 16, that's ≥22 chars. We also reject any
 * non-base64url characters as a structural sanity check.
 */
function isValidNonce(nonce: string): boolean {
  if (typeof nonce !== 'string') return false
  if (nonce.length < Math.ceil((MIN_NONCE_BYTES * 4) / 3)) return false
  return /^[A-Za-z0-9_-]+$/.test(nonce)
}
