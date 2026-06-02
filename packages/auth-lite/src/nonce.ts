/**
 * @fileoverview Server-side nonce generation.
 *
 * Cryptographically-random nonce + expiry timestamp. The caller owns
 * persistence (Redis, Postgres, in-memory map — whatever fits) and
 * single-use enforcement; this function just generates a fresh
 * challenge.
 *
 * Why base64url instead of hex: 33% smaller wire encoding, URL/cookie/
 * header-safe out of the box. The Explore consumer contract specifies
 * base64url; we match it.
 */

/**
 * Bounds on nonce size (bytes):
 * - Minimum 16 bytes (128 bits) — birthday-bound for ≥2^64 issued
 *   nonces, far beyond any realistic application's lifetime.
 * - Maximum 64 bytes (512 bits) — no security benefit beyond this;
 *   we cap to keep the signed plaintext short for wallet UIs.
 */
const MIN_BYTES = 16
const MAX_BYTES = 64
const DEFAULT_BYTES = 32

/**
 * Bounds on nonce TTL (seconds):
 * - Minimum 30s — anything shorter is shorter than a slow wallet
 *   round-trip; users would see "expired" before they had a chance
 *   to sign.
 * - Maximum 1 hour — no reason to hold an unsigned challenge longer
 *   than that; longer TTLs widen the replay window if the server-side
 *   store is leaked.
 */
const MIN_TTL_SECONDS = 30
const MAX_TTL_SECONDS = 60 * 60
const DEFAULT_TTL_SECONDS = 5 * 60

/**
 * Generate a fresh auth nonce with an expiry timestamp (ms epoch).
 *
 * The caller is responsible for:
 * 1. Persisting the nonce in an "issued-but-unused" set.
 * 2. Rejecting `verifyAuthSignature` calls whose nonce isn't in that
 *    set (or has already been consumed, or whose `expiresAt` is past).
 * 3. Deleting the nonce on successful verify (single-use).
 *
 * The library doesn't own that storage — the consumer contract calls
 * it out as the caller's job. This function is purely the
 * generation primitive.
 */
export function generateAuthNonce(opts?: {
  /** Default: 32. Minimum: 16. Maximum: 64. */
  bytes?: number
  /** Default: 300 (5 minutes). Minimum: 30. Maximum: 3600 (1 hour). */
  ttlSeconds?: number
}): { nonce: string; expiresAt: number } {
  const bytes = opts?.bytes ?? DEFAULT_BYTES
  const ttlSeconds = opts?.ttlSeconds ?? DEFAULT_TTL_SECONDS

  if (bytes < MIN_BYTES || bytes > MAX_BYTES) {
    throw new RangeError(`bytes must be between ${MIN_BYTES} and ${MAX_BYTES} (got ${bytes})`)
  }
  if (ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS) {
    throw new RangeError(
      `ttlSeconds must be between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS} (got ${ttlSeconds})`,
    )
  }

  const raw = crypto.getRandomValues(new Uint8Array(bytes))
  const nonce = toBase64Url(raw)
  const expiresAt = Date.now() + ttlSeconds * 1000

  return { nonce, expiresAt }
}

/**
 * Base64url encoding per RFC 4648 §5 — no padding, `-_` instead of
 * `+/`. URL/cookie/header-safe.
 */
function toBase64Url(bytes: Uint8Array): string {
  // btoa expects a binary string of char codes ≤ 0xff, which our bytes
  // satisfy. The String.fromCharCode applied piece-wise avoids the
  // call-stack blow-up that .apply(null, bytes) hits at large sizes.
  let bin = ''
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!)
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
