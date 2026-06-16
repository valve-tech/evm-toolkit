/**
 * Build-time configuration. Everything here is PUBLIC — a static site holds
 * no secrets. RPC-only: this example never indexes, so there are no chifra /
 * Unchained keys here (unlike unchained-tx-history). Swap rpcUrl for your own
 * node, or paste one at runtime (see src/lib/chains.ts).
 */
export interface ChainConfig {
  chainId: number
  label: string
  /** JSON-RPC endpoint. ws:// or wss:// builds a WS transport (subscribeBlocks push); http(s) polls. */
  rpcUrl: string
  /** Native-currency symbol — currently informational; fees print in gwei. */
  symbol: string
  /** Block-explorer base (no trailing slash), for future links. */
  explorerUrl: string
}

// PulseChain (369) leads — the default chain (CHAINS[0]).
export const CHAINS: ChainConfig[] = [
  {
    chainId: 369,
    label: 'PulseChain',
    rpcUrl: 'https://rpc.pulsechain.com',
    symbol: 'PLS',
    explorerUrl: 'https://explore.valve.city',
  },
  {
    chainId: 943,
    label: 'PulseChain Testnet v4',
    rpcUrl: 'https://rpc.v4.testnet.pulsechain.com',
    symbol: 'tPLS',
    explorerUrl: 'https://explore.valve.city',
  },
  {
    chainId: 1,
    label: 'Ethereum',
    rpcUrl: 'https://rpc-ethereum.g4mm4.io',
    symbol: 'ETH',
    explorerUrl: 'https://etherscan.io',
  },
]
