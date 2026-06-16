/**
 * A thin EIP-1193 WalletAdapter over window.ethereum (MetaMask / Rabby / etc).
 * No project IDs, no connector config — this shows exactly how to implement
 * the @valve-tech/wallet-adapter `WalletAdapter` interface against any injected
 * provider. The same provider also backs a viem WalletClient for the
 * replacement (speed-up / cancel) path, which needs nonce control.
 */
import {
  createWalletClient,
  custom,
  numberToHex,
  type Chain,
  type Hex,
  type WalletClient,
} from 'viem'
import type {
  WalletAdapter,
  WalletSendTransactionRequest,
} from '@valve-tech/wallet-adapter'

/** The minimal EIP-1193 surface we rely on. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

export const getInjectedProvider = (): Eip1193Provider | null => {
  const eth = (globalThis as { ethereum?: Eip1193Provider }).ethereum
  return eth ?? null
}

/** Prompt the wallet to connect; returns the selected account (lowercased Hex). */
export const connect = async (
  provider: Eip1193Provider,
): Promise<Hex> => {
  const accounts = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[]
  if (!accounts.length) throw new Error('No account returned by wallet')
  return accounts[0] as Hex
}

/** The wallet's currently-connected chain id. */
export const getChainId = async (
  provider: Eip1193Provider,
): Promise<number> => {
  const hex = (await provider.request({ method: 'eth_chainId' })) as string
  return Number(BigInt(hex))
}

/**
 * Build a WalletAdapter from an injected provider + connected account. It
 * validates request.chainId against the provider's chain and throws on
 * mismatch (the WalletAdapter contract: never silently sign for the wrong
 * network). The wallet supplies the EIP-1559 fee fields straight from the
 * request (which carry the chosen gas-oracle tier).
 */
export const injectedWalletAdapter = (
  provider: Eip1193Provider,
  account: Hex,
): WalletAdapter => ({
  address: account,
  sendTransaction: async (
    request: WalletSendTransactionRequest,
  ): Promise<Hex> => {
    const walletChainId = await getChainId(provider)
    if (walletChainId !== request.chainId) {
      throw new Error(
        `WalletAdapter: wallet is on chain ${walletChainId}, request is ` +
          `for chain ${request.chainId}. Switch network in your wallet first.`,
      )
    }
    const tx: Record<string, string> = {
      from: account,
      to: request.to,
      data: request.data,
      value: numberToHex(request.value ?? 0n),
    }
    if (request.maxFeePerGas !== undefined)
      tx.maxFeePerGas = numberToHex(request.maxFeePerGas)
    if (request.maxPriorityFeePerGas !== undefined)
      tx.maxPriorityFeePerGas = numberToHex(request.maxPriorityFeePerGas)
    const hash = (await provider.request({
      method: 'eth_sendTransaction',
      params: [tx],
    })) as string
    return hash as Hex
  },
})

/**
 * A viem WalletClient over the same injected provider, bound to the connected
 * account + chain. Needed by `replaceTransaction`, which sets an explicit
 * `nonce` (the WalletAdapter request shape has no nonce field).
 */
export const injectedWalletClient = (
  provider: Eip1193Provider,
  account: Hex,
  chain: Chain,
): WalletClient =>
  createWalletClient({
    account,
    chain,
    transport: custom(provider),
  })
