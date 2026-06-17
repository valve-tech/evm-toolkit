/**
 * Connect the injected EIP-1193 wallet and return a viem WalletClient.
 * Throws WalletUnavailable when no provider is present so the caller
 * can handle the wallet surface with one catch (shared error class
 * across auth-lite + wallet-crypto).
 */
import { createWalletClient, custom, type Address, type WalletClient } from 'viem'
import { WalletUnavailable } from '@valve-tech/auth-lite'

export async function connectWallet(): Promise<{ client: WalletClient; address: Address }> {
  const provider = window.ethereum
  if (!provider) throw new WalletUnavailable()
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as Address[]
  const address = accounts[0]
  if (!address) throw new WalletUnavailable()
  const client = createWalletClient({ account: address, transport: custom(provider) })
  return { client, address }
}
