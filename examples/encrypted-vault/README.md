# encrypted-vault

Wallet-login encrypted notes vault. Sign in with your wallet, write private notes encrypted to your wallet key, read them back decrypted on the same or a different device. The server persists ciphertext only and is cryptographically blind to note contents.

Pairs full EIP-4361 SIWE ([`viem/siwe`](https://viem.sh/docs/siwe) + [`@valve-tech/siwe-store`](../../packages/siwe-store) for the server-side nonce + session state) with [`@valve-tech/wallet-crypto`](../../packages/wallet-crypto) (wallet-derived AES-GCM encryption) and [`@valve-tech/wallet-key-session`](../../packages/wallet-key-session) (the memory-only key lifecycle).

---

## What it demonstrates

| Capability | How |
|---|---|
| Wallet login (full EIP-4361 SIWE) | server `createSiweMessage` (nonce from `siwe-store`) → client `signMessage` → server `parseSiweMessage` + `nonceStore.consume` + `validateSiweMessage` + `recoverMessageAddress` → opaque session token |
| Wallet-derived encryption (wallet-crypto) | `deriveWalletEncryptionKey` (purpose `notes-vault`, version `1`) → `encryptEnvelope` / `decryptEnvelope` |
| Server blindness | Store holds `{ ciphertext, nonce }` base64 blobs only; server never sees the key |
| Cross-device determinism | Key derivation is deterministic per wallet+purpose+version; any device with the same wallet decrypts the same notes |
| Quiet rejection handling | `WalletDeclined` / `isUserRejectionError` — no banner on user cancel |

---

## Architecture

```
Browser                              Node server (:8790)
───────                              ─────────────────
connectWallet()
  └─ signAuthChallenge()  ──────►  GET  /auth/nonce
  │   (prompt 1: auth)    ◄──────  { nonce }
  └─ signature            ──────►  POST /auth/verify  →  verifyAuthSignature()
                          ◄──────  { token, address }

getKey()  ← deriveWalletEncryptionKey()
  (prompt 2: key — first encrypt or decrypt only, then cached in-memory)

encryptEnvelope({ key, plaintext, aad: address })
  └─ { ciphertext, nonce }  ──►  POST /notes  (Bearer: token)  →  notes-store.json
fetchNotes()               ◄──  GET  /notes   (Bearer: token)  ←  notes-store.json
decryptEnvelope({ key, ciphertext, nonce, aad: address })
```

**Client:** React + Vite. All crypto runs in the browser (`SubtleCrypto`). Built output lands in `dist/`.

**Server:** Plain Node `http.createServer`. No framework. In production it serves the built client from `dist/` and handles the API on the same origin (`:8790`). In dev, Vite serves the client and proxies `/auth` and `/notes` to the same Node server.

---

## The two-signature design

The example issues exactly two `personal_sign` prompts. They are deliberately distinct.

**Prompt 1 — auth challenge (`signAuthChallenge`)**

Signs a structured auth message containing the app name and a one-time server nonce. The server calls `verifyAuthSignature` to recover the signing address and, if it matches the claimed address and the nonce is valid, issues an opaque random session token. The signature proves *who you are* to the server. It is consumed immediately; the session token is the only thing that persists.

**Prompt 2 — key derivation (`deriveWalletEncryptionKey`)**

Signs a deterministic derivation message with purpose `notes-vault` and version `1`. The resulting bytes are fed into `PBKDF2 → AES-GCM` to produce a non-extractable `CryptoKey`. This key *never leaves the browser* and the server never sees it. It proves *only you can read your notes*. The key is derived lazily — first encrypt or decrypt triggers the prompt; subsequent operations reuse the in-memory cached key.

Combining auth and key derivation into one prompt would conflate two separate security properties. Keeping them separate makes the trust model explicit: the server verifies identity; the key is strictly client-side.

---

## Server blindness

The note store (`notes-store.json`) holds base64-encoded ciphertext and AES-GCM IV only. On-disk shape:

```json
{
  "0xabc...": [
    { "ciphertext": "...", "nonce": "..." },
    { "ciphertext": "...", "nonce": "..." }
  ]
}
```

Running `cat notes-store.json` shows only opaque base64. The server cannot decrypt a note because it never holds the key. AAD (additional authenticated data) is set to the signer's address, so a blob is cryptographically bound to the address that created it — replaying it under a different account fails MAC verification.

---

## Cross-device determinism

`deriveWalletEncryptionKey` is a pure function of the wallet + purpose string + version integer. Given the same wallet signing on a second browser or device, the derivation produces the same AES-GCM key byte-for-byte. The server returns the same ciphertext blobs to any authenticated request from that address, and the client decrypts them identically. No key synchronisation or export is needed.

---

## How to run

### Dev mode (two terminals)

**Terminal A — server:**

```bash
yarn workspace @valve-tech/example-encrypted-vault run dev:server
```

Starts the Node server on `:8790` with `tsx watch` (restarts on file change).

**Terminal B — client:**

```bash
yarn workspace @valve-tech/example-encrypted-vault run dev
```

Starts Vite on its default port (typically `:5173`). Vite proxies `/auth` and `/notes` to `:8790`. Open the Vite URL in a browser with an injected EVM wallet.

### Production mode (same origin)

```bash
yarn workspace @valve-tech/example-encrypted-vault run build
yarn workspace @valve-tech/example-encrypted-vault run start
```

`build` compiles the client (`tsc` + `vite build` → `dist/`) and the server (`tsc` → `dist-server/`). `start` runs the compiled server on `:8790`, which serves the built client as static files and handles the API on the same origin — no Vite proxy needed.

---

## Manual e2e steps

These flows exercise the full path; signing prompts require a real wallet and cannot run in CI.

**Happy path:**

1. Open the app. Click **Connect & Sign In**. Accept the wallet connection prompt (or skip if already connected).
2. **Prompt 1 (auth):** sign the auth challenge. The identity bar should show your address.
3. In the composer, type a note and click **Encrypt & save**.
4. **Prompt 2 (key derivation):** sign the key-derivation message. The note appears in the list as a locked row.
5. Inspect `notes-store.json` — confirm it contains only base64 strings, not your note text.
6. Reload the page, sign in again (prompt 1 only — the key is not cached across page loads). Tap a locked row. Prompt 2 fires once; the note decrypts. Tap a second locked row — no additional prompt (key cached in-memory for the session).

**Cross-device determinism:**

7. Open a second browser profile (or incognito window). Sign in with the same wallet. The same ciphertext blobs load.
8. Tap a locked row. Prompt 2 fires. The note decrypts to the original text — same key derived, no data transfer between browsers.

**Error paths:**

- Cancel either signing prompt — the app resets silently (no error banner).
- Restart the server mid-session — the in-memory session store clears; subsequent `/notes` requests return 401. The UI should surface the auth error message.

---

## Testing

Server security logic is unit-tested (nonce replay prevention, session expiry, address isolation). Signing flows are manual only — no wallet is available in CI.

```bash
yarn vitest run --root examples/encrypted-vault
```

> **Note:** `notes-store.json` is a demo-only JSON file. A real app uses a database. The in-memory nonce and session stores reset on server restart. The unlocked read-modify-write on the JSON file means two near-simultaneous note saves can drop one (last-writer-wins) — fine for a single-user demo, not for production.
