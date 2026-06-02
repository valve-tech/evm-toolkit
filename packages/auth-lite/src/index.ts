/**
 * @fileoverview Public API of `@valve-tech/auth-lite`.
 *
 * SIWE-lite authentication primitives: server-issued nonce + client
 * personal_sign + server recover. Deliberately narrower than full
 * EIP-4361 — see the README for the threat-model rationale and when
 * to reach for full SIWE instead.
 *
 * Pairs with `@valve-tech/wallet-crypto` for products that also need
 * wallet-derived encryption.
 */

// Client-side
export { signAuthChallenge } from './challenge.js'

// Server-side
export { generateAuthNonce } from './nonce.js'
export { verifyAuthSignature } from './verify.js'

// Shared
export { formatAuthMessage, AUTH_MESSAGE_TEMPLATE } from './messages.js'

// Errors
export {
  WalletDeclined,
  WalletUnavailable,
  InvalidNonce,
  SignatureMismatch,
} from './errors.js'
