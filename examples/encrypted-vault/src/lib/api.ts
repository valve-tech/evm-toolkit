/**
 * Typed fetch wrappers for the vault API. Same-origin in prod (the
 * Node server serves the client); proxied to the server in dev.
 */
import type { Address, Hex } from 'viem'
import type { WireBlob } from './blob.js'

export class AuthError extends Error {}

/** GET the server-built EIP-4361 SIWE message to sign. */
export async function fetchChallenge(address: Address, chainId: number): Promise<string> {
  const res = await fetch(`/auth/challenge?address=${address}&chainId=${chainId}`)
  if (!res.ok) throw new AuthError('could not get a sign-in challenge')
  return ((await res.json()) as { message: string }).message
}

/** POST the signed message + signature; get back an opaque session token. */
export async function verifySignature(input: {
  message: string
  signature: Hex
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
