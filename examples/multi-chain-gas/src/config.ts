/**
 * Build-time configuration. Everything here is PUBLIC — a static site holds
 * no secrets. All configured chains run CONCURRENTLY (one ChainSource +
 * GasOracle pipeline each); keep the list short enough for the public RPCs'
 * rate limits.
 */
export interface ChainConfig {
  chainId: number
  label: string
  /** JSON-RPC endpoint. ws:// or wss:// builds a WS transport; http(s) polls. */
  rpcUrl: string
  /** Native-currency symbol — informational; fees print in gwei. */
  symbol: string
  /** Block-explorer base (no trailing slash), for future links. */
  explorerUrl: string
}

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

/** Label lookup for alert firings and table headers. */
export const chainLabel = (chainId: number): string =>
  CHAINS.find((c) => c.chainId === chainId)?.label ?? `chain ${chainId}`
