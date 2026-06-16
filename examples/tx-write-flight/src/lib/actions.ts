/**
 * Pure mapping from a UI Action to the wallet-adapter request shape, plus the
 * cancel-tx builder. No I/O, no wallet calls — these are the testable seams of
 * the send path. The fee fields come from a gas-oracle tier (see TierRecommendation).
 */
import { encodeFunctionData, type Hex } from 'viem'
import type {
  WalletSendTransactionRequest,
} from '@valve-tech/wallet-adapter'
import type { ReplaceTransactionOriginal } from '@valve-tech/tx-tracker'

import { WETH_ABI } from '../config'

/** The three anchor actions, each driving a different lifecycle path. */
export type Action =
  | { kind: 'send'; to: Hex; amountWei: bigint }
  | { kind: 'wrap'; amountWei: bigint }
  | { kind: 'unwrap'; amountWei: bigint }

/** Resolved fee fields from a gas-oracle TierRecommendation. */
export interface ResolvedGas {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}

export interface BuildContext {
  chainId: number
  from: Hex
  /** Canonical WETH address — required for wrap/unwrap; ignored for send. */
  weth: Hex | null
  gas: ResolvedGas
}

/** Map an Action + context to the wallet-adapter request. */
export const buildTransactionRequest = (
  action: Action,
  ctx: BuildContext,
): WalletSendTransactionRequest => {
  const fee = {
    chainId: ctx.chainId,
    maxFeePerGas: ctx.gas.maxFeePerGas,
    maxPriorityFeePerGas: ctx.gas.maxPriorityFeePerGas,
  }
  switch (action.kind) {
    case 'send':
      return { to: action.to, data: '0x', value: action.amountWei, ...fee }
    case 'wrap': {
      if (!ctx.weth) throw new Error('wrap requires a WETH address for this chain')
      return {
        to: ctx.weth,
        data: encodeFunctionData({ abi: WETH_ABI, functionName: 'deposit' }),
        value: action.amountWei,
        ...fee,
      }
    }
    case 'unwrap': {
      if (!ctx.weth) throw new Error('unwrap requires a WETH address for this chain')
      return {
        to: ctx.weth,
        data: encodeFunctionData({
          abi: WETH_ABI,
          functionName: 'withdraw',
          args: [action.amountWei],
        }),
        value: 0n,
        ...fee,
      }
    }
  }
}

export interface CancelContext {
  from: Hex
  chainId: number
  nonce: number
}

/**
 * A cancel is a 0-value self-send on the SAME nonce. Returned as a
 * `ReplaceTransactionOriginal` so it can be threaded straight into
 * `replaceTransaction` with a bumped gas params object.
 */
export const buildCancelRequest = (
  ctx: CancelContext,
): ReplaceTransactionOriginal => ({
  to: ctx.from,
  value: 0n,
  nonce: ctx.nonce,
  chainId: ctx.chainId,
  data: '0x',
})
