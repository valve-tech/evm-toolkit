/**
 * ERC-4337 wiring: smart account construction, bundler + paymaster
 * clients, and the send-one-UserOperation orchestration with phase
 * callbacks. Everything network-bound lives here; the phase/fee logic
 * it consumes is pure (`userop.ts`).
 *
 * Account model: Coinbase Smart Account v1 (EntryPoint 0.6) — its
 * factory + implementation are production-deployed across mainnet and
 * major testnets, and the anvil fixture script clones them locally.
 */
import {
  createPublicClient,
  http,
  type Hex,
  type LocalAccount,
  type PublicClient,
} from 'viem'
import {
  createBundlerClient,
  createPaymasterClient,
  toCoinbaseSmartAccount,
  type SmartAccount,
} from 'viem/account-abstraction'

import type { AaChainConfig } from '../config'
import { UserOpPhase, type UserOpFees } from './userop'

/** One public client per chain config. */
export const buildClient = (chain: AaChainConfig): PublicClient =>
  createPublicClient({
    transport: http(chain.rpcUrl),
    chain: {
      id: chain.chainId,
      name: chain.label,
      nativeCurrency: { name: chain.symbol, symbol: chain.symbol, decimals: 18 },
      rpcUrls: { default: { http: [chain.rpcUrl] } },
    },
  }) as PublicClient

/**
 * `clientFactory` registry for the tx-flight strip's `addByHash`
 * rehydrate path — must not capture rendered state (same pattern as
 * tx-write-flight).
 */
const clients = new Map<number, PublicClient>()
export const registerClient = (chainId: number, client: PublicClient): void => {
  clients.set(chainId, client)
}
export const clientFactory = (chainId: number): PublicClient | undefined =>
  clients.get(chainId)

/** Derive the (counterfactual) smart account for a demo owner key. */
export const buildSmartAccount = (
  client: PublicClient,
  owner: LocalAccount,
): Promise<SmartAccount> =>
  toCoinbaseSmartAccount({ client, owners: [owner], version: '1' })

export interface SmartAccountStatus {
  address: Hex
  deployed: boolean
  balanceWei: bigint
}

/** Address + deploy-state + balance for the account panel. */
export const readAccountStatus = async (
  client: PublicClient,
  account: SmartAccount,
): Promise<SmartAccountStatus> => {
  const [deployed, balanceWei] = await Promise.all([
    account.isDeployed(),
    client.getBalance({ address: account.address }),
  ])
  return { address: account.address, deployed, balanceWei }
}

export interface SendDemoOpParams {
  client: PublicClient
  account: SmartAccount
  bundlerUrl: string
  /** Optional ERC-7677-style paymaster RPC for gas sponsorship. */
  paymasterUrl?: string
  /**
   * Fees from the gas oracle's tier, or null to let the bundler
   * estimate (the honest fallback when no oracle state exists yet).
   */
  fees: UserOpFees | null
  /** Demo action: send this much wei from the smart account to itself. */
  valueWei?: bigint
  onPhase: (phase: UserOpPhase) => void
}

export interface SendDemoOpResult {
  userOpHash: Hex
  transactionHash: Hex
  blockNumber: bigint
  success: boolean
  actualGasUsed: bigint
}

/**
 * Send one demo UserOperation (a self-call) and wait for its bundled
 * inclusion. Phase callbacks fire in ladder order; a throw at any
 * point is preceded by `onPhase('failed')`.
 *
 * The first op for a fresh account also carries the factory initCode —
 * the account contract deploys as a side effect of its first bundle
 * (that's the counterfactual-deploy half of 4337).
 */
export const sendDemoOp = async (
  params: SendDemoOpParams,
): Promise<SendDemoOpResult> => {
  const {
    client,
    account,
    bundlerUrl,
    paymasterUrl,
    fees,
    valueWei = 0n,
    onPhase,
  } = params

  const bundler = createBundlerClient({
    account,
    client,
    transport: http(bundlerUrl),
    ...(paymasterUrl
      ? { paymaster: createPaymasterClient({ transport: http(paymasterUrl) }) }
      : {}),
  })

  try {
    onPhase(UserOpPhase.preparing)
    // sendUserOperation internally estimates gas limits, fills nonce +
    // initCode, then requests the owner's signature — the signing phase
    // is flagged just before the call since the demo owner signs
    // synchronously in-process.
    onPhase(UserOpPhase.signing)
    const userOpHash = await bundler.sendUserOperation({
      calls: [{ to: account.address, value: valueWei }],
      ...(fees ?? {}),
    })

    onPhase(UserOpPhase.submitted)
    const receipt = await bundler.waitForUserOperationReceipt({
      hash: userOpHash,
    })

    onPhase(UserOpPhase.bundled)
    return {
      userOpHash,
      transactionHash: receipt.receipt.transactionHash,
      blockNumber: receipt.receipt.blockNumber,
      success: receipt.success,
      actualGasUsed: receipt.actualGasUsed,
    }
  } catch (err) {
    onPhase(UserOpPhase.failed)
    throw err
  }
}
