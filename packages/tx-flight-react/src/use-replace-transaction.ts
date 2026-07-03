'use client'

/**
 * @fileoverview `useReplaceTransaction(id?)` — speed-up / cancel a
 * stuck transaction and reflect the replacement on the flight strip.
 *
 * The mechanical primitive already lives in `@valve-tech/tx-tracker`
 * (`replaceTransaction` — a same-nonce send with bumped EIP-1559 fees,
 * via a viem `WalletClient`). This hook is the React ergonomics around
 * it: it fires that primitive, tracks `isReplacing` / `error` as render
 * state, and — on success — flips the original strip entry to
 * `replaced` with `replacedBy` set to the new hash (the same terminal
 * state the tracker emits when it observes a `replaced-by` on its own).
 *
 * `tx-tracker` is dynamic-imported inside the action (it's an optional
 * peer dep) so consumers who never replace don't pay its bundle cost —
 * the same discipline as `addByHash`.
 *
 * The bumped fees (`newGas`) are supplied by the caller, NOT computed
 * here: fee strategy is a separate concern (see
 * `@valve-tech/gas-oracle`'s replacement bump helper), and keeping it
 * out of this hook keeps the two decoupled. The replacement fees MUST
 * strictly exceed the original's or the mempool rejects the swap; most
 * nodes additionally require a ~10% bump. This hook does not enforce a
 * policy it can't know — it forwards whatever `newGas` you pass.
 *
 * Wiring maps cleanly onto `<TxFlightActions>`: pass `speedUp`/`cancel`
 * into its `onSpeedUp`/`onCancel` slots.
 */

import { useCallback, useState } from 'react'
import type { Hex, WalletClient } from 'viem'
import type { TrackedTx } from '@valve-tech/wallet-adapter'

import { _getStoreForId, _useTxFlightContext } from './provider.js'

/** Bumped EIP-1559 fees for the replacement. Must exceed the original's. */
export interface ReplacementGas {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}

/** Input to `speedUp` — re-send the same call at a higher fee. */
export interface SpeedUpInput {
  /** The strip entry being replaced; its `id` is flipped to `replaced`. */
  tx: TrackedTx
  /** viem WalletClient that will sign the same-nonce replacement. */
  walletClient: WalletClient
  /**
   * The original request, including its `nonce` — the strip doesn't
   * store calldata/nonce, so the caller supplies them.
   */
  original: {
    to: Hex
    nonce: number
    data?: Hex
    value?: bigint
    chainId?: number
  }
  /** Bumped fees. */
  newGas: ReplacementGas
}

/** Input to `cancel` — replace the stuck tx with a 0-value self-send. */
export interface CancelInput {
  /** The strip entry being replaced; its `id` is flipped to `replaced`. */
  tx: TrackedTx
  /** viem WalletClient that will sign the same-nonce replacement. */
  walletClient: WalletClient
  /** The stuck transaction's nonce (the strip doesn't store it). */
  nonce: number
  /** Bumped fees. */
  newGas: ReplacementGas
  /** Recipient of the self-send. Defaults to `walletClient.account.address`. */
  to?: Hex
}

export interface UseReplaceTransactionReturn {
  /** Re-send the original call at a higher fee. Resolves to the new hash. */
  speedUp: (input: SpeedUpInput) => Promise<Hex>
  /** Replace the stuck tx with a 0-value self-send at a higher fee. */
  cancel: (input: CancelInput) => Promise<Hex>
  /** True while a replacement is in flight. */
  isReplacing: boolean
  /** The last replacement error, or `null`. Cleared when a new one starts. */
  error: Error | null
}

/**
 * Speed-up / cancel affordances for a Provider's strip.
 *
 * Resolves the store id the same way {@link useTxFlight} does (explicit
 * arg → ambient Provider → `'default'`) and throws if no Provider is
 * registered for it.
 *
 * @example
 * ```tsx
 * const { speedUp, cancel, isReplacing } = useReplaceTransaction()
 * <TxFlightActions
 *   tx={tx}
 *   onSpeedUp={(tx) => speedUp({ tx, walletClient, original, newGas })}
 *   onCancel={(tx) => cancel({ tx, walletClient, nonce: original.nonce, newGas })}
 * />
 * ```
 */
export const useReplaceTransaction = (id?: string): UseReplaceTransactionReturn => {
  const ambient = _useTxFlightContext()
  const resolvedId = id ?? ambient?.id ?? 'default'
  const store = _getStoreForId(resolvedId)
  if (!store) {
    throw new Error(
      `[@valve-tech/tx-flight-react] No <TxFlightProvider id="${resolvedId}"> found in tree`,
    )
  }

  const [isReplacing, setIsReplacing] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const run = useCallback(
    async (
      tx: TrackedTx,
      walletClient: WalletClient,
      original: SpeedUpInput['original'],
      newGas: ReplacementGas,
    ): Promise<Hex> => {
      setIsReplacing(true)
      setError(null)
      try {
        // Dynamic import — keeps tx-tracker off the bundle for consumers
        // who never replace. Same discipline as addByHash.
        const { replaceTransaction } = await import('@valve-tech/tx-tracker')
        const newHash = await replaceTransaction({ original, walletClient, newGas })
        store.dispatch.update(tx.id, { status: 'replaced', replacedBy: newHash })
        return newHash
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        setError(e)
        throw e
      } finally {
        setIsReplacing(false)
      }
    },
    [store],
  )

  const speedUp = useCallback(
    (input: SpeedUpInput): Promise<Hex> =>
      run(input.tx, input.walletClient, input.original, input.newGas),
    [run],
  )

  const cancel = useCallback(
    (input: CancelInput): Promise<Hex> => {
      const to = input.to ?? input.walletClient.account?.address
      if (!to) {
        return Promise.reject(
          new Error(
            '[@valve-tech/tx-flight-react] cancel: walletClient must have an account, or pass `to`',
          ),
        )
      }
      return run(
        input.tx,
        input.walletClient,
        { to, nonce: input.nonce, value: 0n, data: '0x', chainId: input.tx.chainId },
        input.newGas,
      )
    },
    [run],
  )

  return { speedUp, cancel, isReplacing, error }
}
