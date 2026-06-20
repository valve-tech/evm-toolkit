/**
 * SIWE (EIP-4361) authentication — the verify decision, extracted as a
 * pure, dependency-injected function so it is unit-testable without a
 * live HTTP server, wallet, or RPC.
 *
 * The verify order is load-bearing:
 *   1. consume the nonce (single-use / replay — burns it on any attempt)
 *   2. re-assert the binding fields viem's validateSiweMessage does NOT
 *      check (version / uri / chainId) against server config
 *   3. validateSiweMessage — domain binding + time validity + address
 *      presence (the checks viem owns)
 *   4. verify the signature against the message's address
 *
 * Step 4 is injected (`verifySignature`). In production it is a hybrid:
 * an offline ECDSA recover fast-path for EOAs, falling back to a viem
 * PublicClient's `verifyMessage` for EIP-1271 / EIP-6492 smart accounts.
 * Injecting it keeps this module free of any RPC/wallet dependency and
 * lets tests exercise every branch (EOA-valid, contract-valid, invalid,
 * thrown) deterministically.
 */
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import type { Address, Hex } from 'viem'

/** The binding fields the server is authoritative for. */
export interface SiweConfig {
  /** EIP-4361 `domain` — checked by validateSiweMessage. */
  domain: string
  /** EIP-4361 `uri` — pinned explicitly (validateSiweMessage ignores it). */
  uri: string
  /** EIP-4361 `chainId` — pinned explicitly (validateSiweMessage ignores it). */
  chainId: number
  /** EIP-4361 `version` — pinned explicitly; MUST be `'1'`. */
  version: string
}

/**
 * Verify a signed SIWE message and return the authenticated address, or
 * `null` on ANY failure (a single null keeps the caller's response
 * uniform — no leak of which check failed).
 *
 * @param opts.consumeNonce - Single-use nonce check (e.g. a
 *   `@valve-tech/siwe-store` `NonceStore.consume`). Called first, so a
 *   nonce is burned on every attempt regardless of outcome.
 * @param opts.verifySignature - Signature verifier. Returns true iff
 *   `signature` is a valid signature of `message` by `address`. In
 *   production this handles EOA (ECDSA) and EIP-1271/6492 (contract)
 *   accounts; injected so this function needs no RPC.
 */
export async function authenticateSiwe(opts: {
  message: string
  signature: Hex
  config: SiweConfig
  consumeNonce: (nonce: string) => boolean
  verifySignature: (args: {
    address: Address
    message: string
    signature: Hex
  }) => Promise<boolean>
}): Promise<Address | null> {
  const fields = parseSiweMessage(opts.message)

  // 1) single-use / replay defense.
  if (!fields.nonce || !opts.consumeNonce(fields.nonce)) return null

  // 2) re-assert binding fields validateSiweMessage does NOT check.
  if (
    fields.version !== opts.config.version ||
    fields.uri !== opts.config.uri ||
    fields.chainId !== opts.config.chainId
  ) {
    return null
  }

  // 3) domain binding + time validity + address presence (viem's checks).
  if (!validateSiweMessage({ message: fields, domain: opts.config.domain })) {
    return null
  }
  if (!fields.address) return null

  // 4) signature — EOA and/or EIP-1271/6492, via the injected verifier.
  let valid: boolean
  try {
    valid = await opts.verifySignature({
      address: fields.address,
      message: opts.message,
      signature: opts.signature,
    })
  } catch {
    return null
  }
  if (!valid) return null

  return fields.address
}
