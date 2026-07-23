/**
 * Demo owner key management. The smart account's owner is a THROWAWAY
 * key generated in the browser and kept in localStorage — this keeps
 * the full UserOp signing path self-contained (no wallet-extension
 * raw-hash-signing quirks) and is exactly as unsafe as it sounds:
 * anyone with the localStorage value owns the account.
 *
 * DEMO / TESTNET ONLY. Never fund a smart account owned by one of
 * these keys with real value.
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Hex, LocalAccount } from 'viem'

const STORAGE_KEY = 'erc4337-write-flight:owner-key'

const isHexKey = (value: string): value is Hex =>
  /^0x[0-9a-fA-F]{64}$/.test(value)

/** The persisted demo key, or null. */
export const loadOwnerKey = (): Hex | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw !== null && isHexKey(raw) ? raw : null
  } catch {
    return null
  }
}

/** Generate, persist, and return a fresh demo key. */
export const createOwnerKey = (): Hex => {
  const key = generatePrivateKey()
  localStorage.setItem(STORAGE_KEY, key)
  return key
}

/** Import a pasted key (validated), persist it, return it — or null. */
export const importOwnerKey = (raw: string): Hex | null => {
  const trimmed = raw.trim()
  if (!isHexKey(trimmed)) return null
  localStorage.setItem(STORAGE_KEY, trimmed)
  return trimmed
}

/** Drop the persisted key (the smart account stays on chain). */
export const forgetOwnerKey = (): void => {
  localStorage.removeItem(STORAGE_KEY)
}

/** viem LocalAccount for the key — the smart account's `owners[0]`. */
export const toOwnerAccount = (key: Hex): LocalAccount =>
  privateKeyToAccount(key)
