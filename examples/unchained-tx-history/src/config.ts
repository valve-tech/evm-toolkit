/**
 * Build-time configuration. Everything here is PUBLIC by definition — a
 * static site can hold no secrets. Swap any value to point the app at
 * your own infrastructure (see the README).
 *
 * The RPC endpoints use valve's deliberately public, per-IP-rate-limited
 * `vk_demo` key (read-only; transaction-submitting methods are denied at
 * the relay). Replace `rpcUrl` with any EVM RPC — the whole point is that
 * this app is trustless: bring your own node and nothing here depends on
 * valve.
 */

export interface ChainConfig {
  chainId: number
  label: string
  /** TrueBlocks chain key, the map key in the UnchainedIndex contract. */
  chainKey: string
  /** JSON-RPC endpoint for tx hydration on this chain. */
  rpcUrl: string
  /** Native-currency symbol, for value formatting. */
  symbol: string
  /** Block explorer base for tx links (optional). */
  explorerTxUrl?: string
}

/** IPFS gateway serving the index chunks + blooms. */
export const IPFS_GATEWAY = 'https://ipfs.valve.city'

/**
 * The Unchained Index manifest-publication contract (permissionless,
 * same address on every chain) and valve's publisher address. The manifest
 * CID for each chain is read live from this contract so the app never
 * serves a stale, build-time-baked index.
 */
export const UNCHAINED_CONTRACT = '0x0c316b7042b419d07d343f2f4f5bd54ff731183d'
export const VALVE_PUBLISHER = '0xEDE750e437251eb69423713D5bE21CbE88116141'

/**
 * Manifest hashes are published to the contract on Ethereum mainnet (one
 * record per chain key), so manifest resolution always eth_calls chain 1
 * regardless of which chain's history is being read.
 */
export const MANIFEST_LOOKUP_RPC = 'https://rpc.valve.city/v1/vk_demo/evm/1'

export const CHAINS: ChainConfig[] = [
  {
    chainId: 943,
    label: 'PulseChain Testnet v4',
    chainKey: 'pulsechain-v4',
    rpcUrl: 'https://rpc.valve.city/v1/vk_demo/evm/943',
    symbol: 'tPLS',
  },
  {
    chainId: 369,
    label: 'PulseChain',
    chainKey: 'pulsechain',
    rpcUrl: 'https://rpc.valve.city/v1/vk_demo/evm/369',
    symbol: 'PLS',
  },
  {
    chainId: 1,
    label: 'Ethereum',
    chainKey: 'mainnet',
    rpcUrl: 'https://rpc.valve.city/v1/vk_demo/evm/1',
    symbol: 'ETH',
    explorerTxUrl: 'https://etherscan.io/tx/',
  },
]

/**
 * Default scope: the most recent N chunks. Full-history mainnet is
 * hundreds of MB of bloom fetches, so the app bounds to recent activity
 * unless the user opts into "search all history". Per-chunk, not
 * per-block, because chunk block-spans vary wildly across chains.
 */
export const DEFAULT_RECENT_CHUNKS = 6
