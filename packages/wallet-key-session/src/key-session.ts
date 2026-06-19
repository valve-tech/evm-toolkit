/**
 * @fileoverview Memory-only lifecycle for a wallet-derived encryption key.
 *
 * The CryptoKey lives ONLY in a closure variable — it is never written
 * to localStorage / sessionStorage / IndexedDB / cookies. `getKey()`
 * memoizes the in-flight derivation promise so `derive` runs once even
 * under concurrent callers; `clear()` and any
 * `accountsChanged` / `chainChanged` / `pagehide` event drop the
 * reference so the next `getKey()` re-derives (re-prompting the wallet).
 *
 * The derivation is injected (the `derive` callback), so this lifecycle
 * is unit-testable without a wallet and stays decoupled from
 * `@valve-tech/wallet-crypto` — the consumer wires the two together.
 */

import type { Address } from 'viem'

/** A live, memory-only handle to a wallet-derived encryption key. */
export interface KeySession {
  /** The address the key is bound to. */
  readonly address: Address
  /**
   * Lazily derive the key once; cache the (non-extractable) CryptoKey
   * in memory only. Concurrent calls share one in-flight derivation. A
   * rejected derivation is NOT cached — the next call retries.
   */
  getKey(): Promise<CryptoKey>
  /** Drop the cached key reference (e.g. on sign-out). */
  clear(): void
}

/** The slice of an EIP-1193 provider this package listens on. */
export interface Eip1193Like {
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

/**
 * Create a memory-only key session.
 *
 * @example
 * ```ts
 * const session = createKeySession({
 *   address,
 *   derive: () => deriveWalletEncryptionKey({ signer, purpose: 'notes-vault', version: 1 }),
 *   provider: window.ethereum,
 * })
 * const key = await session.getKey() // first call prompts the wallet
 * ```
 */
export function createKeySession(opts: {
  /** The address the key is bound to. */
  address: Address
  /**
   * Wire the actual derivation here, e.g.
   * `() => deriveWalletEncryptionKey({ signer, purpose, version })`.
   * Injectable so the session is unit-testable without a wallet.
   */
  derive: () => Promise<CryptoKey>
  /** If supplied, auto-`clear()` on `accountsChanged` / `chainChanged`. */
  provider?: Eip1193Like
  /** Default `true`: also `clear()` on `pagehide` (tab close / bfcache evict). */
  clearOnPageHide?: boolean
}): KeySession {
  let cached: Promise<CryptoKey> | null = null

  const clear = (): void => {
    cached = null
  }

  // Wallet identity changed under us — the prior key is no longer valid.
  opts.provider?.on?.('accountsChanged', clear)
  opts.provider?.on?.('chainChanged', clear)

  // Drop the key when the page is going away. Guarded so the package
  // stays import-safe in non-DOM runtimes (SSR, tests).
  const clearOnPageHide = opts.clearOnPageHide ?? true
  if (
    clearOnPageHide &&
    typeof window !== 'undefined' &&
    typeof window.addEventListener === 'function'
  ) {
    window.addEventListener('pagehide', clear)
  }

  return {
    address: opts.address,
    getKey(): Promise<CryptoKey> {
      // Assigning synchronously before the first await is what makes
      // concurrent callers share one derivation. The `.catch` clears
      // the cache on failure so a declined prompt can be retried.
      cached ??= opts.derive().catch((err: unknown) => {
        cached = null
        throw err
      })
      return cached
    },
    clear,
  }
}
