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
        <NoteList notes={notes} onDecrypt={decryptNote} />
      </div>
    </main>
  )
}
