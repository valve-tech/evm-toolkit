# encrypted-vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@valve-tech/example-encrypted-vault` — a wallet-login encrypted notes vault that pairs `@valve-tech/auth-lite` (SIWE-lite sign-in) with `@valve-tech/wallet-crypto` (wallet-derived AES-GCM), proving a server can persist your notes while staying cryptographically blind to them.

**Architecture:** One private workspace with two halves. The **client** is a Vite+React+TS single-column vault (mirrors `examples/unchained-tx-history/`) that connects an injected EIP-1193 wallet, signs in, and encrypts notes client-side before upload. The **server** is a minimal plain-Node HTTP server (mirrors `examples/unchained-index-server/`, no framework) exposing `/auth/nonce`, `/auth/verify`, and `/notes`, with an in-memory nonce store, an opaque in-memory session-token layer, and an address-scoped JSON-file ciphertext store. In production the Node server serves the built client from `dist/`; in dev, Vite proxies `/auth` and `/notes` to the server.

**Tech Stack:** TypeScript, React 18, Vite 5, plain Node `node:http`, viem (`createWalletClient` + `custom` EIP-1193 transport), `@valve-tech/auth-lite`, `@valve-tech/wallet-crypto`, Vitest (server security logic only).

---

## File Structure

All paths are relative to repo root `examples/encrypted-vault/`.

### Workspace / shared config

| File | Responsibility |
| --- | --- |
| `package.json` | Workspace manifest. `@valve-tech/example-encrypted-vault`, `"private": true`. Deps: auth-lite, wallet-crypto, viem, react, react-dom. Scripts: `dev`, `build` (BOTH halves), `typecheck`, `lint`, `test`, `start`. |
| `tsconfig.json` | Client TS config (DOM libs, `jsx: react-jsx`, `noEmit`), mirrors `unchained-tx-history/tsconfig.json`; `include` covers `src` only (client). |
| `tsconfig.server.json` | Server TS config extending `../../tsconfig.base.json`; emits `server/` → `dist-server/`, `types: ["node"]`. |
| `vite.config.ts` | Vite config with React plugin and a dev `server.proxy` mapping `/auth` and `/notes` to `http://localhost:8790`. |
| `index.html` | HTML shell; mounts `#root`, loads `/src/main.tsx`, vault title/meta. |
| `README.md` | Explains the two-signature design (auth vs key), server-blindness proof, cross-device determinism demo, "a real app uses a database" caveat, manual e2e run steps. |
| `.gitignore` | Ignores `dist/`, `dist-server/`, and the runtime ciphertext store file. |

### Server (`server/`)

| File | Responsibility |
| --- | --- |
| `server/config.ts` | Server constants: `APP` (from `process.env.APP_NAME ?? 'Encrypted Vault'`), `PORT`, `SESSION_TTL_MS`, `NONCE_TTL_SECONDS`, store file path. Module-scope `app` per auth-lite invariant #2. |
| `server/nonce-store.ts` | **PURE/TESTABLE.** In-memory issued-nonce set with issue / consume-once / expiry semantics. Wraps `generateAuthNonce`. |
| `server/session-store.ts` | **PURE/TESTABLE.** Opaque random session tokens → address map with TTL; issue / validate / expiry. No JWT. |
| `server/note-store.ts` | **PURE/TESTABLE (with tmp file).** Address-scoped ciphertext blob store backed by a JSON file. `addNote(address, blob)` / `listNotes(address)`; enforces caller-supplied address scoping so one address never sees another's blobs. |
| `server/http.ts` | **PURE/TESTABLE helpers.** `readJsonBody`, `bearerToken(req)`, `sendJson`, `send401`. |
| `server/server.ts` | Wires the stores + auth-lite verify into a `node:http` server: `GET /auth/nonce`, `POST /auth/verify`, `GET/POST /notes` (Bearer-gated), and static serving of `dist/` in prod. |

### Client (`src/`)

| File | Responsibility |
| --- | --- |
| `src/main.tsx` | React entry; renders `<App />` in `StrictMode`. |
| `src/styles.css` | Vault aesthetic: centered single-column card layout, identity bar, composer, note rows. |
| `src/vite-env.d.ts` | Vite client types + `window.ethereum` EIP-1193 type. |
| `src/lib/wallet.ts` | Connect injected EIP-1193 wallet → viem `WalletClient` (`custom(window.ethereum)`). Throws `WalletUnavailable` if no provider. |
| `src/lib/api.ts` | **TESTABLE pure parts.** Typed fetch wrappers for `/auth/nonce`, `/auth/verify`, `/notes`; `base64`↔`Uint8Array` helpers for wire-encoding ciphertext blobs. |
| `src/lib/blob.ts` | **TESTABLE.** Pure `StoredBlob` ⇄ wire-JSON encode/decode (ciphertext + nonce as base64; AAD is the address). |
| `src/lib/session.ts` | Client session state shape (`token`, `address`) and the `deriveWalletEncryptionKey` lazy-key holder (derives on first encrypt/decrypt, purpose `"notes-vault"`, version `1`). |
| `src/App.tsx` | Top-level state machine: signed-out card → connect+sign-in → signed-in vault (identity bar + composer + note list). Catches `WalletDeclined`/`WalletUnavailable`/`isUserRejectionError` once. |
| `src/components/SignInCard.tsx` | Signed-out centered card: "sign in with your wallet to unlock your notes" + Connect & sign in button. |
| `src/components/IdentityBar.tsx` | Address + session badge + Sign out. |
| `src/components/Composer.tsx` | "write a private note…" textarea + Encrypt & save. |
| `src/components/NoteList.tsx` | Encrypted rows; decrypt-on-tap. |

### Tests (server security logic only)

| File | Responsibility |
| --- | --- |
| `server/nonce-store.test.ts` | Issue / expiry / one-time-use (no replay). |
| `server/session-store.test.ts` | Token issue / validate / expiry. |
| `server/note-store.test.ts` | Address-scoped isolation: one address cannot read another's blobs. |
| `src/lib/blob.test.ts` | Pure blob wire-encode/decode roundtrip + base64 helpers. |

---

## Tasks

### Task 1 — Workspace scaffold + config

**Files:**
- Create: `examples/encrypted-vault/package.json`
- Create: `examples/encrypted-vault/tsconfig.json`
- Create: `examples/encrypted-vault/tsconfig.server.json`
- Create: `examples/encrypted-vault/vite.config.ts`
- Create: `examples/encrypted-vault/.gitignore`

**Steps:**

- [ ] Create `examples/encrypted-vault/package.json`:
  ```json
  {
    "name": "@valve-tech/example-encrypted-vault",
    "version": "0.18.0",
    "private": true,
    "description": "Wallet-login encrypted notes vault: sign in with your wallet, write private notes encrypted to your wallet, read them back decrypted. The server persists ciphertext only and is cryptographically blind to your notes. Pairs @valve-tech/auth-lite (SIWE-lite) with @valve-tech/wallet-crypto (wallet-derived AES-GCM).",
    "license": "MIT",
    "type": "module",
    "scripts": {
      "dev": "vite",
      "dev:server": "tsx watch server/server.ts",
      "build": "tsc -p tsconfig.json && tsc -p tsconfig.server.json && vite build",
      "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit",
      "lint": "eslint src server",
      "test": "vitest run",
      "start": "node dist-server/server/server.js"
    },
    "dependencies": {
      "@valve-tech/auth-lite": "^0.18.0",
      "@valve-tech/wallet-crypto": "^0.18.0",
      "react": "^18.3.1",
      "react-dom": "^18.3.1",
      "viem": "^2.21.0"
    },
    "devDependencies": {
      "@types/react": "^18.3.0",
      "@types/react-dom": "^18.3.0",
      "@vitejs/plugin-react": "^4.3.0",
      "tsx": "^4.19.0",
      "vite": "^5.4.0"
    }
  }
  ```
- [ ] Create `examples/encrypted-vault/tsconfig.json` (client; mirrors `unchained-tx-history/tsconfig.json`):
  ```json
  {
    "compilerOptions": {
      "target": "ES2020",
      "useDefineForClassFields": true,
      "lib": ["ES2020", "DOM", "DOM.Iterable"],
      "module": "ESNext",
      "skipLibCheck": true,
      "moduleResolution": "Bundler",
      "allowImportingTsExtensions": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "noEmit": true,
      "jsx": "react-jsx",
      "strict": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true,
      "noFallthroughCasesInSwitch": true
    },
    "include": ["src", "vite.config.ts"]
  }
  ```
- [ ] Create `examples/encrypted-vault/tsconfig.server.json` (server; extends base, emits JS):
  ```json
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "outDir": "dist-server",
      "rootDir": ".",
      "module": "ESNext",
      "moduleResolution": "Bundler",
      "lib": ["ES2020"],
      "types": ["node"],
      "noEmit": false,
      "composite": false,
      "declaration": false,
      "declarationMap": false
    },
    "include": ["server"]
  }
  ```
- [ ] Create `examples/encrypted-vault/vite.config.ts`:
  ```ts
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'

  // Client builds to dist/ (served by the Node server in prod). In dev,
  // Vite serves the client and proxies the API to the local Node server.
  const SERVER = 'http://localhost:8790'

  export default defineConfig({
    plugins: [react()],
    base: './',
    build: { outDir: 'dist', target: 'es2020' },
    server: {
      proxy: {
        '/auth': SERVER,
        '/notes': SERVER,
      },
    },
  })
  ```
- [ ] Create `examples/encrypted-vault/.gitignore`:
  ```
  dist/
  dist-server/
  notes-store.json
  ```
- [ ] Commit: `git add examples/encrypted-vault && git commit -m "feat(examples): encrypted-vault — workspace scaffold + config"`

---

### Task 2 — Server config module

**Files:**
- Create: `examples/encrypted-vault/server/config.ts`

**Steps:**

- [ ] Create `examples/encrypted-vault/server/config.ts`:
  ```ts
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
  ```
- [ ] Commit: `git add examples/encrypted-vault/server/config.ts && git commit -m "feat(examples): encrypted-vault — server config module"`

---

### Task 3 — Nonce store (TDD: issue / expiry / one-time-use)

**Files:**
- Create: `examples/encrypted-vault/server/nonce-store.ts`
- Test: `examples/encrypted-vault/server/nonce-store.test.ts`

**Steps:**

- [ ] Write failing test `examples/encrypted-vault/server/nonce-store.test.ts`:
  ```ts
  import { describe, it, expect, vi, afterEach } from 'vitest'
  import { createNonceStore } from './nonce-store'

  afterEach(() => vi.useRealTimers())

  describe('nonce store', () => {
    it('issues a base64url nonce that consume() accepts exactly once', () => {
      const store = createNonceStore()
      const { nonce } = store.issue()
      expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(store.consume(nonce)).toBe(true)
      // one-time-use: a replay of the same nonce is rejected
      expect(store.consume(nonce)).toBe(false)
    })

    it('rejects an unknown nonce', () => {
      const store = createNonceStore()
      expect(store.consume('never-issued')).toBe(false)
    })

    it('rejects an expired nonce', () => {
      vi.useFakeTimers()
      const store = createNonceStore({ ttlSeconds: 60 })
      const { nonce } = store.issue()
      vi.advanceTimersByTime(61_000)
      expect(store.consume(nonce)).toBe(false)
    })
  })
  ```
- [ ] Run (expect FAIL — module missing): `yarn workspace @valve-tech/example-encrypted-vault run test`
- [ ] Create `examples/encrypted-vault/server/nonce-store.ts`:
  ```ts
  /**
   * In-memory issued-nonce set. Single-use + TTL enforcement is the
   * caller's job per auth-lite invariant #1 — this is that caller.
   * consume() deletes on hit so a replayed nonce is rejected.
   */
  import { generateAuthNonce } from '@valve-tech/auth-lite'
  import { NONCE_TTL_SECONDS } from './config.js'

  export interface NonceStore {
    issue(): { nonce: string }
    /** True if the nonce was issued, unexpired, and unconsumed. Deletes on hit. */
    consume(nonce: string): boolean
  }

  export function createNonceStore(opts?: { ttlSeconds?: number }): NonceStore {
    const ttlSeconds = opts?.ttlSeconds ?? NONCE_TTL_SECONDS
    const issued = new Map<string, { expiresAt: number }>()

    return {
      issue() {
        const { nonce, expiresAt } = generateAuthNonce({ ttlSeconds })
        issued.set(nonce, { expiresAt })
        return { nonce }
      },
      consume(nonce) {
        const stored = issued.get(nonce)
        if (!stored) return false
        // Atomic-ish delete BEFORE the time check so a race-loser can't reuse.
        issued.delete(nonce)
        if (stored.expiresAt < Date.now()) return false
        return true
      },
    }
  }
  ```
- [ ] Run (expect PASS): `yarn workspace @valve-tech/example-encrypted-vault run test`
- [ ] Commit: `git add examples/encrypted-vault/server/nonce-store.ts examples/encrypted-vault/server/nonce-store.test.ts && git commit -m "feat(examples): encrypted-vault — nonce store (issue/expiry/one-time-use)"`

---

### Task 4 — Session store (TDD: issue / validate / expiry)

**Files:**
- Create: `examples/encrypted-vault/server/session-store.ts`
- Test: `examples/encrypted-vault/server/session-store.test.ts`

**Steps:**

- [ ] Write failing test `examples/encrypted-vault/server/session-store.test.ts`:
  ```ts
  import { describe, it, expect, vi, afterEach } from 'vitest'
  import { createSessionStore } from './session-store'

  const ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const

  afterEach(() => vi.useRealTimers())

  describe('session store', () => {
    it('issues an opaque token that validates back to the address', () => {
      const store = createSessionStore()
      const token = store.issue(ADDR)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(token.length).toBeGreaterThanOrEqual(32)
      expect(store.validate(token)).toBe(ADDR)
    })

    it('returns null for an unknown token', () => {
      const store = createSessionStore()
      expect(store.validate('garbage')).toBeNull()
    })

    it('returns null after the token expires', () => {
      vi.useFakeTimers()
      const store = createSessionStore({ ttlMs: 1000 })
      const token = store.issue(ADDR)
      vi.advanceTimersByTime(1001)
      expect(store.validate(token)).toBeNull()
    })

    it('issues distinct tokens per call', () => {
      const store = createSessionStore()
      expect(store.issue(ADDR)).not.toBe(store.issue(ADDR))
    })
  })
  ```
- [ ] Run (expect FAIL — module missing): `yarn workspace @valve-tech/example-encrypted-vault run test`
- [ ] Create `examples/encrypted-vault/server/session-store.ts`:
  ```ts
  /**
   * Opaque server-side session layer. auth-lite deliberately stops at
   * verify and issues NO session — this minimal token store is the
   * example's own layer on top of that boundary (the teaching point).
   * Random token → address, short TTL, in-memory.
   */
  import { randomBytes } from 'node:crypto'
  import type { Address } from 'viem'
  import { SESSION_TTL_MS } from './config.js'

  export interface SessionStore {
    issue(address: Address): string
    /** The bound address if the token is known and unexpired, else null. */
    validate(token: string): Address | null
  }

  export function createSessionStore(opts?: { ttlMs?: number }): SessionStore {
    const ttlMs = opts?.ttlMs ?? SESSION_TTL_MS
    const sessions = new Map<string, { address: Address; expiresAt: number }>()

    return {
      issue(address) {
        const token = randomBytes(32).toString('base64url')
        sessions.set(token, { address, expiresAt: Date.now() + ttlMs })
        return token
      },
      validate(token) {
        const stored = sessions.get(token)
        if (!stored) return null
        if (stored.expiresAt < Date.now()) {
          sessions.delete(token)
          return null
        }
        return stored.address
      },
    }
  }
  ```
- [ ] Run (expect PASS): `yarn workspace @valve-tech/example-encrypted-vault run test`
- [ ] Commit: `git add examples/encrypted-vault/server/session-store.ts examples/encrypted-vault/server/session-store.test.ts && git commit -m "feat(examples): encrypted-vault — opaque session store (issue/validate/expiry)"`

---

### Task 5 — Note store (TDD: address-scoped isolation)

**Files:**
- Create: `examples/encrypted-vault/server/note-store.ts`
- Test: `examples/encrypted-vault/server/note-store.test.ts`

**Steps:**

- [ ] Write failing test `examples/encrypted-vault/server/note-store.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import { mkdtempSync, rmSync } from 'node:fs'
  import { tmpdir } from 'node:os'
  import { join } from 'node:path'
  import { createNoteStore, type StoredBlob } from './note-store'

  const ALICE = '0xAAAaAAaaAaaaAaaAaAAAAaaAAAaAAAAaAaAaAAAa' as const
  const BOB = '0xBBbBBBBbBBbBbBbbBbbbBBbBBBBBbBbbBbBBbBBB' as const
  const blob = (n: number): StoredBlob => ({ ciphertext: `ct-${n}`, nonce: `iv-${n}` })

  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vault-'))
    path = join(dir, 'store.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  describe('note store address isolation', () => {
    it('returns only the blobs written under the requesting address', () => {
      const store = createNoteStore(path)
      store.addNote(ALICE, blob(1))
      store.addNote(BOB, blob(2))
      store.addNote(ALICE, blob(3))
      expect(store.listNotes(ALICE)).toEqual([blob(1), blob(3)])
      expect(store.listNotes(BOB)).toEqual([blob(2)])
    })

    it('normalizes address casing so the same wallet sees its notes', () => {
      const store = createNoteStore(path)
      store.addNote(ALICE, blob(1))
      expect(store.listNotes(ALICE.toLowerCase() as typeof ALICE)).toEqual([blob(1)])
    })

    it('returns an empty list for an address with no notes', () => {
      const store = createNoteStore(path)
      expect(store.listNotes(BOB)).toEqual([])
    })

    it('persists across store instances (survives restart)', () => {
      createNoteStore(path).addNote(ALICE, blob(1))
      expect(createNoteStore(path).listNotes(ALICE)).toEqual([blob(1)])
    })
  })
  ```
- [ ] Run (expect FAIL — module missing): `yarn workspace @valve-tech/example-encrypted-vault run test`
- [ ] Create `examples/encrypted-vault/server/note-store.ts`:
  ```ts
  /**
   * Address-scoped CIPHERTEXT store. The server stores envelope blobs
   * only and never the key — it is cryptographically blind to note
   * contents. Backed by a JSON file so notes survive a restart.
   * README: "a real app uses a database."
   */
  import { readFileSync, writeFileSync, existsSync } from 'node:fs'
  import type { Address } from 'viem'

  /** Base64-encoded AES-GCM ciphertext + its 12-byte IV ("nonce"). */
  export interface StoredBlob {
    ciphertext: string
    nonce: string
  }

  export interface NoteStore {
    addNote(address: Address, blob: StoredBlob): void
    listNotes(address: Address): StoredBlob[]
  }

  type StoreShape = Record<string, StoredBlob[]>

  /** Lowercase so checksum vs. non-checksum casing maps to one bucket. */
  const key = (address: Address): string => address.toLowerCase()

  export function createNoteStore(path: string): NoteStore {
    const read = (): StoreShape =>
      existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as StoreShape) : {}
    const write = (data: StoreShape): void => writeFileSync(path, JSON.stringify(data, null, 2))

    return {
      addNote(address, blob) {
        const data = read()
        const bucket = data[key(address)] ?? []
        bucket.push(blob)
        data[key(address)] = bucket
        write(data)
      },
      listNotes(address) {
        return read()[key(address)] ?? []
      },
    }
  }
  ```
- [ ] Run (expect PASS): `yarn workspace @valve-tech/example-encrypted-vault run test`
- [ ] Commit: `git add examples/encrypted-vault/server/note-store.ts examples/encrypted-vault/server/note-store.test.ts && git commit -m "feat(examples): encrypted-vault — address-scoped ciphertext store"`

---

### Task 6 — HTTP helpers + server wiring

**Files:**
- Create: `examples/encrypted-vault/server/http.ts`
- Create: `examples/encrypted-vault/server/server.ts`

**Steps:**

- [ ] Create `examples/encrypted-vault/server/http.ts`:
  ```ts
  /** Tiny request/response helpers for the plain-Node server. */
  import type { IncomingMessage, ServerResponse } from 'node:http'

  export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  }

  /** Extract the Bearer token from the Authorization header, or null. */
  export function bearerToken(req: IncomingMessage): string | null {
    const header = req.headers.authorization ?? ''
    return header.startsWith('Bearer ') ? header.slice(7) : null
  }

  export function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  export function send401(res: ServerResponse, reason: string): void {
    sendJson(res, 401, { error: reason })
  }
  ```
- [ ] Create `examples/encrypted-vault/server/server.ts`:
  ```ts
  /**
   * Minimal plain-Node HTTP server for the encrypted-vault example.
   *
   * Endpoints:
   *   GET  /auth/nonce            → { nonce }            (issue + persist)
   *   POST /auth/verify           → { token, address }   (verify + issue session)
   *   GET  /notes      (Bearer)   → { notes: StoredBlob[] }
   *   POST /notes      (Bearer)   → { ok: true }         (store ciphertext only)
   *
   * The store holds ciphertext only — the server cannot read a note.
   * `app` for verify comes from server config, never the request body
   * (auth-lite invariant #2). In production this also serves dist/.
   */
  import { createServer } from 'node:http'
  import { readFile } from 'node:fs/promises'
  import { join, normalize } from 'node:path'
  import { verifyAuthSignature } from '@valve-tech/auth-lite'
  import type { Address, Hex } from 'viem'
  import { APP, PORT, STORE_PATH, CLIENT_DIST } from './config.js'
  import { createNonceStore } from './nonce-store.js'
  import { createSessionStore } from './session-store.js'
  import { createNoteStore, type StoredBlob } from './note-store.js'
  import { readJsonBody, bearerToken, sendJson, send401 } from './http.js'

  const nonces = createNonceStore()
  const sessions = createSessionStore()
  const notes = createNoteStore(STORE_PATH)

  interface VerifyBody { nonce: string; signature: Hex; address: Address }
  interface NoteBody { blob: StoredBlob }

  const contentType = (path: string): string => {
    if (path.endsWith('.html')) return 'text/html'
    if (path.endsWith('.js')) return 'text/javascript'
    if (path.endsWith('.css')) return 'text/css'
    return 'application/octet-stream'
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = req.method ?? 'GET'

    void (async (): Promise<void> => {
      try {
        // --- Auth: issue a nonce ---
        if (method === 'GET' && url.pathname === '/auth/nonce') {
          sendJson(res, 200, nonces.issue())
          return
        }

        // --- Auth: verify a signature, issue an opaque session token ---
        if (method === 'POST' && url.pathname === '/auth/verify') {
          const body = await readJsonBody<VerifyBody>(req)
          if (!nonces.consume(body.nonce)) {
            send401(res, 'bad, expired, or replayed nonce')
            return
          }
          // CRITICAL: app from server config, NOT body.
          const recovered = await verifyAuthSignature({
            app: APP,
            nonce: body.nonce,
            signature: body.signature,
            claimedAddress: body.address,
          })
          if (!recovered) {
            send401(res, 'invalid signature')
            return
          }
          const token = sessions.issue(recovered)
          sendJson(res, 200, { token, address: recovered })
          return
        }

        // --- Notes: Bearer-gated, address-scoped ---
        if (url.pathname === '/notes' && (method === 'GET' || method === 'POST')) {
          const token = bearerToken(req)
          const address = token ? sessions.validate(token) : null
          if (!address) {
            send401(res, 'missing or expired session')
            return
          }
          if (method === 'GET') {
            sendJson(res, 200, { notes: notes.listNotes(address) })
            return
          }
          const body = await readJsonBody<NoteBody>(req)
          notes.addNote(address, body.blob)
          sendJson(res, 200, { ok: true })
          return
        }

        // --- Static client (production) ---
        const rel = url.pathname === '/' ? '/index.html' : url.pathname
        const filePath = normalize(join(CLIENT_DIST, rel))
        if (!filePath.startsWith(CLIENT_DIST)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        try {
          const file = await readFile(filePath)
          res.writeHead(200, { 'content-type': contentType(filePath) })
          res.end(file)
        } catch {
          res.writeHead(404)
          res.end('not found')
        }
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
    })()
  })

  server.listen(PORT, () => {
    console.log(`encrypted-vault server listening on :${PORT}  (app "${APP}")`)
  })
  ```
- [ ] Run typecheck (expect PASS): `yarn workspace @valve-tech/example-encrypted-vault run typecheck`
- [ ] Commit: `git add examples/encrypted-vault/server/http.ts examples/encrypted-vault/server/server.ts && git commit -m "feat(examples): encrypted-vault — HTTP helpers + node server (auth + notes + static)"`

---

### Task 7 — Client blob + base64 helpers (TDD)

**Files:**
- Create: `examples/encrypted-vault/src/lib/blob.ts`
- Test: `examples/encrypted-vault/src/lib/blob.test.ts`

**Steps:**

- [ ] Write failing test `examples/encrypted-vault/src/lib/blob.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { bytesToBase64, base64ToBytes, encodeBlob, decodeBlob } from './blob'

  describe('base64 byte helpers', () => {
    it('roundtrips arbitrary bytes', () => {
      const bytes = new Uint8Array([0, 1, 2, 250, 251, 255])
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
    })
  })

  describe('blob wire encoding', () => {
    it('roundtrips a ciphertext+nonce pair through the wire shape', () => {
      const ciphertext = new Uint8Array([10, 20, 30])
      const nonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
      const wire = encodeBlob({ ciphertext, nonce })
      expect(typeof wire.ciphertext).toBe('string')
      expect(typeof wire.nonce).toBe('string')
      const back = decodeBlob(wire)
      expect(back.ciphertext).toEqual(ciphertext)
      expect(back.nonce).toEqual(nonce)
    })
  })
  ```
- [ ] Run (expect FAIL — module missing): `yarn workspace @valve-tech/example-encrypted-vault run test`
- [ ] Create `examples/encrypted-vault/src/lib/blob.ts`:
  ```ts
  /**
   * Wire-encoding for AES-GCM envelope blobs. The server stores these
   * base64 strings verbatim and never sees the plaintext or the key.
   * The `nonce` here is the AES-GCM IV from encryptEnvelope — NOT the
   * auth nonce from @valve-tech/auth-lite (same word, different concept).
   */

  /** The on-the-wire shape the server persists (base64 strings). */
  export interface WireBlob {
    ciphertext: string
    nonce: string
  }

  /** The in-memory shape encryptEnvelope/decryptEnvelope use. */
  export interface RawBlob {
    ciphertext: Uint8Array
    nonce: Uint8Array
  }

  export function bytesToBase64(bytes: Uint8Array): string {
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return btoa(binary)
  }

  export function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }

  export function encodeBlob(blob: RawBlob): WireBlob {
    return { ciphertext: bytesToBase64(blob.ciphertext), nonce: bytesToBase64(blob.nonce) }
  }

  export function decodeBlob(wire: WireBlob): RawBlob {
    return { ciphertext: base64ToBytes(wire.ciphertext), nonce: base64ToBytes(wire.nonce) }
  }
  ```
- [ ] Run (expect PASS): `yarn workspace @valve-tech/example-encrypted-vault run test`
- [ ] Commit: `git add examples/encrypted-vault/src/lib/blob.ts examples/encrypted-vault/src/lib/blob.test.ts && git commit -m "feat(examples): encrypted-vault — client blob wire encode/decode (tested)"`

---

### Task 8 — Client wallet + API + session libs

**Files:**
- Create: `examples/encrypted-vault/src/vite-env.d.ts`
- Create: `examples/encrypted-vault/src/lib/wallet.ts`
- Create: `examples/encrypted-vault/src/lib/api.ts`
- Create: `examples/encrypted-vault/src/lib/session.ts`

**Steps:**

- [ ] Create `examples/encrypted-vault/src/vite-env.d.ts`:
  ```ts
  /// <reference types="vite/client" />

  import type { EIP1193Provider } from 'viem'

  declare global {
    interface Window {
      ethereum?: EIP1193Provider
    }
  }
  ```
- [ ] Create `examples/encrypted-vault/src/lib/wallet.ts`:
  ```ts
  /**
   * Connect the injected EIP-1193 wallet and return a viem WalletClient.
   * Throws WalletUnavailable when no provider is present so the caller
   * can handle the wallet surface with one catch (shared error class
   * across auth-lite + wallet-crypto).
   */
  import { createWalletClient, custom, type Address, type WalletClient } from 'viem'
  import { WalletUnavailable } from '@valve-tech/auth-lite'

  export async function connectWallet(): Promise<{ client: WalletClient; address: Address }> {
    const provider = window.ethereum
    if (!provider) throw new WalletUnavailable()
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as Address[]
    const address = accounts[0]
    if (!address) throw new WalletUnavailable()
    const client = createWalletClient({ account: address, transport: custom(provider) })
    return { client, address }
  }
  ```
- [ ] Create `examples/encrypted-vault/src/lib/api.ts`:
  ```ts
  /**
   * Typed fetch wrappers for the vault API. Same-origin in prod (the
   * Node server serves the client); proxied to the server in dev.
   */
  import type { Address, Hex } from 'viem'
  import type { WireBlob } from './blob.js'

  export class AuthError extends Error {}

  export async function fetchNonce(): Promise<string> {
    const res = await fetch('/auth/nonce')
    if (!res.ok) throw new AuthError('could not get a nonce')
    return ((await res.json()) as { nonce: string }).nonce
  }

  export async function verifySignature(input: {
    nonce: string
    signature: Hex
    address: Address
  }): Promise<{ token: string; address: Address }> {
    const res = await fetch('/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({ error: 'auth failed' }))) as { error: string }
      throw new AuthError(error)
    }
    return (await res.json()) as { token: string; address: Address }
  }

  export async function fetchNotes(token: string): Promise<WireBlob[]> {
    const res = await fetch('/notes', { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) throw new AuthError('session expired — sign in again')
    return ((await res.json()) as { notes: WireBlob[] }).notes
  }

  export async function postNote(token: string, blob: WireBlob): Promise<void> {
    const res = await fetch('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ blob }),
    })
    if (!res.ok) throw new AuthError('session expired — sign in again')
  }
  ```
- [ ] Create `examples/encrypted-vault/src/lib/session.ts`:
  ```ts
  /**
   * Client session + lazy encryption-key holder.
   *
   * Two signatures total: (1) the auth sign-in (auth-lite), (2) the
   * key-derivation sign (wallet-crypto), derived LAZILY on first
   * encrypt/decrypt with purpose "notes-vault" version 1. The README
   * explains why these are distinct prompts.
   */
  import { deriveWalletEncryptionKey } from '@valve-tech/wallet-crypto'
  import type { Address, WalletClient } from 'viem'

  export const KEY_PURPOSE = 'notes-vault'
  export const KEY_VERSION = 1

  export interface Session {
    token: string
    address: Address
    client: WalletClient
  }

  /**
   * Returns a memoized key getter. The first call triggers the
   * personal_sign; later calls reuse the derived CryptoKey.
   */
  export function makeKeyProvider(session: Session): () => Promise<CryptoKey> {
    let cached: Promise<CryptoKey> | null = null
    return () => {
      cached ??= deriveWalletEncryptionKey({
        signer: session.client,
        purpose: KEY_PURPOSE,
        version: KEY_VERSION,
      })
      return cached
    }
  }
  ```
- [ ] Run typecheck (expect PASS): `yarn workspace @valve-tech/example-encrypted-vault run typecheck`
- [ ] Commit: `git add examples/encrypted-vault/src/vite-env.d.ts examples/encrypted-vault/src/lib/wallet.ts examples/encrypted-vault/src/lib/api.ts examples/encrypted-vault/src/lib/session.ts && git commit -m "feat(examples): encrypted-vault — client wallet/api/session libs"`

---

### Task 9 — React components

**Files:**
- Create: `examples/encrypted-vault/src/components/SignInCard.tsx`
- Create: `examples/encrypted-vault/src/components/IdentityBar.tsx`
- Create: `examples/encrypted-vault/src/components/Composer.tsx`
- Create: `examples/encrypted-vault/src/components/NoteList.tsx`

**Steps:**

- [ ] Create `examples/encrypted-vault/src/components/SignInCard.tsx`:
  ```tsx
  /** Signed-out state: centered card prompting wallet sign-in. */
  interface Props {
    busy: boolean
    error: string | null
    onSignIn: () => void
  }

  export function SignInCard({ busy, error, onSignIn }: Props) {
    return (
      <div className="card signin">
        <h1 className="vault-title">🔒 Encrypted Vault</h1>
        <p className="lede">Sign in with your wallet to unlock your notes.</p>
        <button className="primary" disabled={busy} onClick={onSignIn}>
          {busy ? 'Check your wallet…' : 'Connect & sign in'}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }
  ```
- [ ] Create `examples/encrypted-vault/src/components/IdentityBar.tsx`:
  ```tsx
  import type { Address } from 'viem'

  interface Props {
    address: Address
    onSignOut: () => void
  }

  const short = (a: Address): string => `${a.slice(0, 6)}…${a.slice(-4)}`

  export function IdentityBar({ address, onSignOut }: Props) {
    return (
      <div className="identity-bar">
        <span className="addr" title={address}>{short(address)}</span>
        <span className="session-badge">session active</span>
        <button className="ghost" onClick={onSignOut}>Sign out</button>
      </div>
    )
  }
  ```
- [ ] Create `examples/encrypted-vault/src/components/Composer.tsx`:
  ```tsx
  import { useState } from 'react'

  interface Props {
    busy: boolean
    onSave: (text: string) => void
  }

  export function Composer({ busy, onSave }: Props) {
    const [text, setText] = useState('')
    const save = () => {
      const trimmed = text.trim()
      if (!trimmed) return
      onSave(trimmed)
      setText('')
    }
    return (
      <div className="composer">
        <textarea
          placeholder="write a private note…"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="primary" disabled={busy || !text.trim()} onClick={save}>
          {busy ? 'Encrypting…' : 'Encrypt & save'}
        </button>
      </div>
    )
  }
  ```
- [ ] Create `examples/encrypted-vault/src/components/NoteList.tsx`:
  ```tsx
  import { useState } from 'react'
  import type { WireBlob } from '../lib/blob.js'

  export interface NoteRow {
    blob: WireBlob
    /** Decrypted text once revealed; undefined while still locked. */
    plaintext?: string
  }

  interface Props {
    notes: NoteRow[]
    onDecrypt: (index: number) => void
  }

  export function NoteList({ notes, onDecrypt }: Props) {
    const [pending, setPending] = useState<number | null>(null)
    if (notes.length === 0) return <p className="empty">No notes yet. Write your first above.</p>
    return (
      <ul className="notes">
        {notes.map((note, i) => (
          <li key={i} className={note.plaintext === undefined ? 'note locked' : 'note open'}>
            {note.plaintext === undefined ? (
              <button
                className="reveal"
                disabled={pending === i}
                onClick={() => {
                  setPending(i)
                  onDecrypt(i)
                }}
              >
                {pending === i ? 'Decrypting…' : '🔒 tap to decrypt'}
              </button>
            ) : (
              <span className="plaintext">{note.plaintext}</span>
            )}
          </li>
        ))}
      </ul>
    )
  }
  ```
- [ ] Run typecheck (expect PASS): `yarn workspace @valve-tech/example-encrypted-vault run typecheck`
- [ ] Commit: `git add examples/encrypted-vault/src/components && git commit -m "feat(examples): encrypted-vault — vault React components"`

**Manual verification note:** Components are rendered/exercised by the manual e2e run in Task 12. The signing flows require a real injected wallet, so they are intentionally not unit-tested (no wallet in CI).

---

### Task 10 — App orchestration

**Files:**
- Create: `examples/encrypted-vault/src/App.tsx`
- Create: `examples/encrypted-vault/src/main.tsx`

**Steps:**

- [ ] Create `examples/encrypted-vault/src/App.tsx`:
  ```tsx
  /**
   * Vault state machine. Signed-out → connect + sign in (auth-lite) →
   * signed-in vault. Notes are encrypted client-side (wallet-crypto)
   * before upload; the server only ever sees ciphertext. AAD binds each
   * envelope to the signer's address so a blob can't be replayed under a
   * different account. Wallet rejection (WalletDeclined / user-rejection)
   * quietly resets to idle — no scary banner.
   */
  import { useCallback, useEffect, useState } from 'react'
  import { encryptEnvelope, decryptEnvelope, WalletDeclined, WalletUnavailable } from '@valve-tech/wallet-crypto'
  import { isUserRejectionError } from '@valve-tech/viem-errors'
  import { signAuthChallenge } from '@valve-tech/auth-lite'
  import { connectWallet } from './lib/wallet.js'
  import { fetchNonce, verifySignature, fetchNotes, postNote, AuthError } from './lib/api.js'
  import { makeKeyProvider, type Session } from './lib/session.js'
  import { encodeBlob, decodeBlob } from './lib/blob.js'
  import { SignInCard } from './components/SignInCard.js'
  import { IdentityBar } from './components/IdentityBar.js'
  import { Composer } from './components/Composer.js'
  import { NoteList, type NoteRow } from './components/NoteList.js'

  const APP_NAME = 'Encrypted Vault'

  export function App() {
    const [session, setSession] = useState<Session | null>(null)
    const [getKey, setGetKey] = useState<(() => Promise<CryptoKey>) | null>(null)
    const [notes, setNotes] = useState<NoteRow[]>([])
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // One catch for the whole wallet surface.
    const handleWalletError = useCallback((err: unknown): void => {
      if (err instanceof WalletDeclined || isUserRejectionError(err)) return // quiet cancel
      if (err instanceof WalletUnavailable) { setError('No wallet found. Install a browser wallet.'); return }
      if (err instanceof AuthError) { setError(err.message); return }
      setError(err instanceof Error ? err.message : String(err))
    }, [])

    const signIn = useCallback(async (): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        const { client, address } = await connectWallet()
        const nonce = await fetchNonce()
        const { signature } = await signAuthChallenge({ signer: client, app: APP_NAME, nonce })
        const verified = await verifySignature({ nonce, signature, address })
        const next: Session = { token: verified.token, address: verified.address, client }
        setSession(next)
        setGetKey(() => makeKeyProvider(next))
      } catch (err) {
        handleWalletError(err)
      } finally {
        setBusy(false)
      }
    }, [handleWalletError])

    const signOut = useCallback((): void => {
      setSession(null)
      setGetKey(null)
      setNotes([])
      setError(null)
    }, [])

    // Load ciphertext blobs once signed in (still locked until tapped).
    useEffect(() => {
      if (!session) return
      let live = true
      fetchNotes(session.token)
        .then((blobs) => { if (live) setNotes(blobs.map((blob) => ({ blob }))) })
        .catch(handleWalletError)
      return () => { live = false }
    }, [session, handleWalletError])

    const addNote = useCallback(async (text: string): Promise<void> => {
      if (!session || !getKey) return
      setBusy(true)
      setError(null)
      try {
        const key = await getKey() // first call triggers the key-derivation sign
        const aad = new TextEncoder().encode(session.address) // bind to the signer
        const { ciphertext, nonce } = await encryptEnvelope({
          key,
          plaintext: new TextEncoder().encode(text),
          aad,
        })
        const wire = encodeBlob({ ciphertext, nonce })
        await postNote(session.token, wire)
        setNotes((prev) => [...prev, { blob: wire, plaintext: text }])
      } catch (err) {
        handleWalletError(err)
      } finally {
        setBusy(false)
      }
    }, [session, getKey, handleWalletError])

    const decryptNote = useCallback(async (index: number): Promise<void> => {
      if (!session || !getKey) return
      setError(null)
      try {
        const key = await getKey()
        const aad = new TextEncoder().encode(session.address)
        const { ciphertext, nonce } = decodeBlob(notes[index].blob)
        const plaintextBytes = await decryptEnvelope({ key, ciphertext, nonce, aad })
        const plaintext = new TextDecoder().decode(plaintextBytes)
        setNotes((prev) => prev.map((n, i) => (i === index ? { ...n, plaintext } : n)))
      } catch (err) {
        handleWalletError(err)
      }
    }, [session, getKey, notes, handleWalletError])

    if (!session) {
      return (
        <main className="shell">
          <SignInCard busy={busy} error={error} onSignIn={() => void signIn()} />
        </main>
      )
    }

    return (
      <main className="shell">
        <div className="card vault">
          <IdentityBar address={session.address} onSignOut={signOut} />
          <Composer busy={busy} onSave={(text) => void addNote(text)} />
          {error && <p className="error">{error}</p>}
          <NoteList notes={notes} onDecrypt={(i) => void decryptNote(i)} />
        </div>
      </main>
    )
  }
  ```
- [ ] Create `examples/encrypted-vault/src/main.tsx`:
  ```tsx
  import React from 'react'
  import ReactDOM from 'react-dom/client'

  import { App } from './App'
  import './styles.css'

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
  ```
- [ ] Add the `@valve-tech/viem-errors` dependency (used by `isUserRejectionError` in App.tsx) to `examples/encrypted-vault/package.json` `dependencies`, after the `@valve-tech/auth-lite` line:
  ```json
      "@valve-tech/auth-lite": "^0.18.0",
      "@valve-tech/viem-errors": "^0.18.0",
  ```
- [ ] Run typecheck (expect PASS): `yarn workspace @valve-tech/example-encrypted-vault run typecheck`
- [ ] Commit: `git add examples/encrypted-vault/src/App.tsx examples/encrypted-vault/src/main.tsx examples/encrypted-vault/package.json && git commit -m "feat(examples): encrypted-vault — App orchestration (sign-in + encrypt/decrypt)"`

---

### Task 11 — HTML shell + styles

**Files:**
- Create: `examples/encrypted-vault/index.html`
- Create: `examples/encrypted-vault/src/styles.css`

**Steps:**

- [ ] Create `examples/encrypted-vault/index.html`:
  ```html
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Encrypted Vault — wallet-encrypted private notes</title>
      <meta
        name="description"
        content="Sign in with your wallet and write private notes encrypted to your wallet. The server stores ciphertext only and is cryptographically blind to your notes. Demonstrates @valve-tech/auth-lite + @valve-tech/wallet-crypto."
      />
      <meta name="theme-color" content="#0b0b0d" />
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="/src/main.tsx"></script>
    </body>
  </html>
  ```
- [ ] Create `examples/encrypted-vault/src/styles.css` (centered single-column "vault/safe" identity — Layout A):
  ```css
  :root {
    --bg: #0b0b0d;
    --panel: #15151a;
    --line: #2a2a33;
    --ink: #e8e8ee;
    --muted: #9a9aa8;
    --accent: #4ade80;
    --danger: #f87171;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  .shell {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 2rem 1rem;
  }
  .card {
    width: 100%;
    max-width: 32rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 1rem;
    padding: 1.5rem;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  }
  .signin { text-align: center; }
  .vault-title { margin: 0 0 0.25rem; font-size: 1.5rem; letter-spacing: 0.02em; }
  .lede { color: var(--muted); margin: 0 0 1.25rem; }
  button.primary {
    width: 100%;
    padding: 0.75rem 1rem;
    border: 0;
    border-radius: 0.6rem;
    background: var(--accent);
    color: #06281a;
    font-weight: 700;
    cursor: pointer;
  }
  button.primary:disabled { opacity: 0.5; cursor: default; }
  button.ghost {
    background: transparent;
    border: 1px solid var(--line);
    color: var(--muted);
    border-radius: 0.5rem;
    padding: 0.35rem 0.7rem;
    cursor: pointer;
  }
  .identity-bar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding-bottom: 1rem;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--line);
  }
  .identity-bar .addr { font-family: ui-monospace, monospace; font-size: 0.95rem; }
  .session-badge {
    margin-left: auto;
    font-size: 0.72rem;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
  }
  .composer { display: grid; gap: 0.6rem; margin-bottom: 1.25rem; }
  .composer textarea {
    width: 100%;
    min-height: 4.5rem;
    resize: vertical;
    background: #0f0f13;
    border: 1px solid var(--line);
    border-radius: 0.6rem;
    color: var(--ink);
    padding: 0.6rem 0.7rem;
    font: inherit;
  }
  .notes { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .note {
    border: 1px solid var(--line);
    border-radius: 0.6rem;
    padding: 0.6rem 0.7rem;
    background: #0f0f13;
  }
  .note.locked .reveal {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }
  .note.open .plaintext { white-space: pre-wrap; }
  .empty { color: var(--muted); text-align: center; }
  .error { color: var(--danger); margin: 0.75rem 0 0; }
  ```
- [ ] Commit: `git add examples/encrypted-vault/index.html examples/encrypted-vault/src/styles.css && git commit -m "feat(examples): encrypted-vault — HTML shell + vault styling"`

---

### Task 12 — README + full-build gate + manual e2e

**Files:**
- Create: `examples/encrypted-vault/README.md`

**Steps:**

- [ ] Create `examples/encrypted-vault/README.md` covering:
  - **What it is:** wallet-login encrypted notes vault pairing `@valve-tech/auth-lite` + `@valve-tech/wallet-crypto`.
  - **The two-signature design (why two distinct prompts):** signature 1 is the **auth challenge** (`signAuthChallenge`, proves address ownership, consumed by the server to issue an opaque session token); signature 2 is the **key derivation** (`deriveWalletEncryptionKey`, purpose `notes-vault` version `1`, never leaves the browser, produces a non-extractable AES-GCM key). They are deliberately separate: auth proves *who you are* to the server; the key proves *only you can read your notes* and is something the server must never see.
  - **Server blindness:** the store (`notes-store.json`) holds base64 ciphertext + IV only; quote the on-disk shape and note you can `cat` it and read nothing.
  - **Cross-device determinism:** `deriveWalletEncryptionKey` is deterministic for the same wallet+purpose+version, so signing in from a second browser decrypts the same notes — same key, byte-for-byte.
  - **Run it (dev):** terminal A `yarn workspace @valve-tech/example-encrypted-vault run dev:server`; terminal B `yarn workspace @valve-tech/example-encrypted-vault run dev`; open the Vite URL; connect a wallet, sign in (1st prompt), write a note + Encrypt & save (2nd prompt), reload and tap a row to decrypt.
  - **Run it (prod):** `yarn workspace @valve-tech/example-encrypted-vault run build` then `yarn workspace @valve-tech/example-encrypted-vault run start`; the Node server serves the built client and the API on the same origin (`:8790`).
  - **Caveat:** "a real app uses a database" — the JSON file is for the demo only; the in-memory nonce/session stores reset on restart.
  - **Testing:** server security logic (nonce replay, session expiry, address isolation) is unit-tested; signing flows are manual (no wallet in CI).
- [ ] Run the full test gate (expect PASS — all server + blob tests): `yarn workspace @valve-tech/example-encrypted-vault run test`
- [ ] Run lint (expect PASS): `yarn workspace @valve-tech/example-encrypted-vault run lint`
- [ ] Run the build gate — builds BOTH halves (client `tsc` + server `tsc` + `vite build`) (expect PASS): `yarn workspace @valve-tech/example-encrypted-vault run build`
- [ ] **Manual e2e** (documented, not CI): start `dev:server` and `dev`, then in a browser with an injected wallet: connect → sign in (prompt 1) → write + Encrypt & save (prompt 2) → confirm `notes-store.json` contains only base64 → reload → tap a locked row → confirm it decrypts to the original text. Open a second browser profile, sign in with the same wallet, confirm the same notes decrypt (cross-device determinism).
- [ ] Commit: `git add examples/encrypted-vault/README.md && git commit -m "docs(examples): encrypted-vault — README (two-signature design, blindness, determinism, run + e2e)"`

---

### Task 13 — Root workspace integration check

**Files:**
- Modify: none expected (root `workspaces` already globs `examples/*`)

**Steps:**

- [ ] Confirm the new workspace is picked up: `yarn workspaces list | grep example-encrypted-vault` (expect the path to print).
- [ ] Run the root build to confirm topological-dev ordering builds auth-lite + wallet-crypto before the example (expect PASS): `yarn build`
- [ ] Run the root test + lint + typecheck gates (expect PASS): `yarn test && yarn lint && yarn typecheck`
- [ ] If `yarn.lock` changed from adding the workspace deps, commit it: `git add yarn.lock && git commit -m "chore: lockfile for @valve-tech/example-encrypted-vault"` (skip if no change).

---

## Notes on spec → task mapping

Every spec requirement maps to a task:

- Single private workspace, both halves, correct deps → Task 1.
- Prod server serves built client; dev Vite proxy of `/auth` + `/notes` → Tasks 1 (proxy/build), 6 (static serving).
- Connect EIP-1193 → nonce → `signAuthChallenge` → `verifyAuthSignature` → opaque session token (random, in-memory, short TTL) → Bearer on `/notes` → Tasks 4, 6, 8, 10.
- `deriveWalletEncryptionKey` (purpose `notes-vault`, version 1, lazy first use), `encryptEnvelope` with AAD=address, server stores ciphertext only, `decryptEnvelope` on tap → Tasks 5, 8, 9, 10.
- Two signatures + README rationale → Tasks 10, 12.
- Proofs (server blindness, cross-device determinism) → Task 12 README + manual e2e.
- Layout A centered single-column vault → Tasks 9, 11.
- Shared typed errors (`WalletDeclined`/`WalletUnavailable`), `isUserRejectionError` quiet cancel, auth 401s → Tasks 6 (401s), 8/10 (error handling).
- JSON-file ciphertext store keyed by address → Task 5.
- Tests: server security logic only; build is the gate → Tasks 3, 4, 5 (security tests), 7 (one pure client helper test, allowed by "minimal client-side unit tests for any pure helpers"), 12/13 (build gate).

**Unmapped / flagged:** None — all spec requirements are covered. The aesthetic/theming pass is explicitly out of scope per the spec ("separate cross-cutting theming task"); Task 11 ships only a self-contained baseline vault style, not the shared theme.
