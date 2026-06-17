/**
 * Server-side configuration. `APP` MUST come from trusted server
 * context (auth-lite invariant #2) — never from a request body.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Shown in the wallet prompt and bound into the signed auth message. */
export const APP = process.env.APP_NAME ?? 'Encrypted Vault'

export const PORT = Number(process.env.PORT ?? 8790)

/** Opaque session token lifetime. */
export const SESSION_TTL_MS = 30 * 60 * 1000

/** Auth nonce lifetime (seconds) — passed to generateAuthNonce. */
export const NONCE_TTL_SECONDS = 5 * 60

/** JSON ciphertext store path. README: "a real app uses a database." */
export const STORE_PATH = process.env.STORE_PATH ?? join(__dirname, '..', 'notes-store.json')

/** Built client root, served in production. */
export const CLIENT_DIST = join(__dirname, '..', '..', 'dist')
