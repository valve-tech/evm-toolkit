/**
 * Server-side configuration. The SIWE binding fields (DOMAIN, URI,
 * CHAIN_ID, STATEMENT) MUST come from trusted server context — never
 * from a request body. An attacker who could set `domain` could rebind
 * a signature to a different origin.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** EIP-4361 `domain` — the origin the user is signing in to. */
export const DOMAIN = process.env.SIWE_DOMAIN ?? 'localhost:8790'

/** EIP-4361 `uri` — the full URI the user is signing in to. */
export const URI = process.env.SIWE_URI ?? 'http://localhost:8790'

/** EIP-4361 `chainId`. The server is authoritative for this value. */
export const CHAIN_ID = Number(process.env.SIWE_CHAIN_ID ?? 1)

/** EIP-4361 `statement` — the human-readable line shown in the wallet. */
export const STATEMENT =
  process.env.SIWE_STATEMENT ??
  'Sign in to the Encrypted Vault. This signature authenticates your session and does NOT authorize any transaction.'

export const PORT = Number(process.env.PORT ?? 8790)

/** Opaque session token lifetime. */
export const SESSION_TTL_MS = 30 * 60 * 1000

/** SIWE nonce lifetime (seconds). Doubles as the message expiry window. */
export const NONCE_TTL_SECONDS = 5 * 60

/** JSON ciphertext store path. README: "a real app uses a database." */
export const STORE_PATH = process.env.STORE_PATH ?? join(__dirname, '..', 'notes-store.json')

/** Built client root, served in production. */
export const CLIENT_DIST = join(__dirname, '..', '..', 'dist')
