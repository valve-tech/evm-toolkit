/**
 * Build a viem PublicClient for a ChainConfig. ws:// or wss:// uses a
 * WebSocket transport (so chain-source can probe a real eth_subscribe push
 * path); everything else uses HTTP (chain-source polls on its interval).
 */
import { createPublicClient, http, webSocket, type PublicClient } from 'viem'
import type { ChainConfig } from '../config'

export const buildClient = (chain: ChainConfig): PublicClient => {
  const isWs = /^wss?:\/\//i.test(chain.rpcUrl)
  const transport = isWs ? webSocket(chain.rpcUrl) : http(chain.rpcUrl)
  // Minimal chain stub — chain-source only needs the transport + id; viem's
  // PublicClient is happy with an id/name/native-currency triple.
  return createPublicClient({
    transport,
    chain: {
      id: chain.chainId,
      name: chain.label,
      nativeCurrency: { name: chain.symbol, symbol: chain.symbol, decimals: 18 },
      rpcUrls: { default: { http: isWs ? [] : [chain.rpcUrl] } },
    },
  }) as PublicClient
}
