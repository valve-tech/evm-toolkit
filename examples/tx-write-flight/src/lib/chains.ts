/**
 * Resolve a connected chain id to a viem Chain (for PublicClient/WalletClient)
 * plus display fields. viem/chains is large, so it's imported lazily and
 * cached; an unknown chain id falls back to a minimal synthetic chain so the
 * app still follows the wallet onto exotic networks.
 */
import { defineChain, type Chain } from 'viem'

export interface ChainDisplay {
  chain: Chain
  label: string
  symbol: string
  explorerUrl: string | null
}

let registryCache: Chain[] | null = null

const loadRegistry = async (): Promise<Chain[]> => {
  if (!registryCache) {
    const mod = await import('viem/chains')
    registryCache = (Object.values(mod) as unknown[]).filter(
      (c): c is Chain =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as { id?: unknown }).id === 'number',
    )
  }
  return registryCache
}

const fallbackChain = (chainId: number, rpcUrl: string): Chain =>
  defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  })

/**
 * Build a ChainDisplay for the connected chain. `rpcUrl` is the wallet's own
 * RPC endpoint (the EIP-1193 provider) — used as the http transport URL so
 * reads go through the same node the wallet uses.
 */
export const resolveChain = async (
  chainId: number,
  rpcUrl: string,
): Promise<ChainDisplay> => {
  const known = (await loadRegistry()).find((c) => c.id === chainId)
  const chain = known ?? fallbackChain(chainId, rpcUrl)
  return {
    chain,
    label: chain.name,
    symbol: chain.nativeCurrency.symbol,
    explorerUrl: chain.blockExplorers?.default.url ?? null,
  }
}
