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
