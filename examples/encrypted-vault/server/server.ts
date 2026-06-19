/**
 * Minimal plain-Node HTTP server for the encrypted-vault example.
 *
 * Endpoints:
 *   GET  /auth/challenge?address=&chainId=  → { message }   (issue nonce + build SIWE message)
 *   POST /auth/verify                       → { token, address }  (consume nonce + validate + recover)
 *   GET  /notes      (Bearer)               → { notes: StoredBlob[] }
 *   POST /notes      (Bearer)               → { ok: true }   (store ciphertext only)
 *
 * The store holds ciphertext only — the server cannot read a note. All
 * SIWE binding fields come from server config, never the request body.
 * In production this also serves dist/.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { createMemoryNonceStore, createMemorySessionStore } from '@valve-tech/siwe-store'
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from 'viem/siwe'
import { recoverMessageAddress, isAddressEqual, getAddress, type Hex } from 'viem'
import { DOMAIN, URI, CHAIN_ID, STATEMENT, PORT, NONCE_TTL_SECONDS, SESSION_TTL_MS, STORE_PATH, CLIENT_DIST } from './config.js'
import { createNoteStore, type StoredBlob } from './note-store.js'
import { readJsonBody, bearerToken, sendJson, send401 } from './http.js'

const nonces = createMemoryNonceStore({ ttlSeconds: NONCE_TTL_SECONDS })
const sessions = createMemorySessionStore({ ttlMs: SESSION_TTL_MS })
const notes = createNoteStore(STORE_PATH)

interface VerifyBody { message: string; signature: Hex }
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
      // --- Auth: issue a nonce and build the EIP-4361 message ---
      if (method === 'GET' && url.pathname === '/auth/challenge') {
        const rawAddress = url.searchParams.get('address')
        if (!rawAddress) {
          sendJson(res, 400, { error: 'address query param required' })
          return
        }
        let address: `0x${string}`
        try {
          address = getAddress(rawAddress) // validate + checksum
        } catch {
          sendJson(res, 400, { error: 'malformed address' })
          return
        }
        // CHAIN_ID / DOMAIN / URI / STATEMENT come from server config,
        // NOT the request. The client's ?chainId= is advisory only.
        const message = createSiweMessage({
          address,
          chainId: CHAIN_ID,
          domain: DOMAIN,
          uri: URI,
          version: '1',
          nonce: nonces.issue(),
          statement: STATEMENT,
          issuedAt: new Date(),
          expirationTime: new Date(Date.now() + NONCE_TTL_SECONDS * 1000),
        })
        sendJson(res, 200, { message })
        return
      }

      // --- Auth: verify the signed message, issue an opaque session ---
      if (method === 'POST' && url.pathname === '/auth/verify') {
        const body = await readJsonBody<VerifyBody>(req)
        const fields = parseSiweMessage(body.message)

        // 1) single-use / replay defense — the nonce store IS the check.
        if (!fields.nonce || !nonces.consume(fields.nonce)) {
          send401(res, 'bad, expired, or replayed nonce')
          return
        }
        // 2) domain binding + time validity (expirationTime/notBefore).
        if (!validateSiweMessage({ message: fields, domain: DOMAIN })) {
          send401(res, 'invalid SIWE message')
          return
        }
        // 3) crypto: recovered signer must equal the message's address.
        let recovered: `0x${string}`
        try {
          recovered = await recoverMessageAddress({ message: body.message, signature: body.signature })
        } catch {
          send401(res, 'invalid signature')
          return
        }
        if (!fields.address || !isAddressEqual(recovered, fields.address)) {
          send401(res, 'invalid signature')
          return
        }
        const token = sessions.issue(fields.address)
        sendJson(res, 200, { token, address: fields.address })
        return
      }

      // --- Notes: Bearer-gated, address-scoped ---
      if (url.pathname === '/notes' && (method === 'GET' || method === 'POST')) {
        const token = bearerToken(req)
        const session = token ? sessions.validate(token) : null
        if (!session) {
          send401(res, 'missing or expired session')
          return
        }
        if (method === 'GET') {
          sendJson(res, 200, { notes: notes.listNotes(session.address) })
          return
        }
        const body = await readJsonBody<NoteBody>(req)
        notes.addNote(session.address, body.blob)
        sendJson(res, 200, { ok: true })
        return
      }

      // --- Static client (production) ---
      const rel = url.pathname === '/' ? '/index.html' : url.pathname
      const filePath = normalize(join(CLIENT_DIST, rel))
      if (filePath !== CLIENT_DIST && !filePath.startsWith(CLIENT_DIST + sep)) {
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
  console.log(`encrypted-vault server listening on :${PORT}  (domain "${DOMAIN}")`)
})
