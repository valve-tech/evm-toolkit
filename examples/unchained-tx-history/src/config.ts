/**
 * Build-time configuration. Everything here is PUBLIC by definition — a
 * static site can hold no secrets. Swap any value to point the app at
 * your own infrastructure (see the README).
 *
 * The RPC endpoints are public community nodes (rpc.pulsechain.com,
 * rpc-ethereum.g4mm4.io) used read-only for tx hydration. Replace `rpcUrl`
 * with any EVM RPC — the whole point is that this app can run trustless:
 * bring your own node (and clear `CHIFRA_URL`) and nothing here depends on
 * valve.
 */

export interface ChainConfig {
  chainId: number
  label: string
  /** TrueBlocks chain key, the map key in the UnchainedIndex contract. */
  chainKey: string
  /**
   * chifra daemon chain name (the `chain` param of `chifra list`). Often the
   * same as `chainKey`, but the daemon's config can name a chain differently
   * — keep this separate so it's easy to correct per chain.
   */
  chifraChain: string
  /** JSON-RPC endpoint for tx hydration on this chain. */
  rpcUrl: string
  /** Native-currency symbol, for value formatting. */
  symbol: string
  /** Block-explorer base (no trailing slash) for tx/block/address links. */
  explorerUrl: string
}

/** IPFS gateway serving the index chunks + blooms. */
export const IPFS_GATEWAY = 'https://ipfs.valve.city'

/**
 * Optional backend accelerator. When `VITE_BACKEND_URL` is set at build/dev
 * time, the app streams from `@valve-tech/example-unchained-index-server`
 * (in-memory bloom scan) instead of doing the multi-GB bloom scan in the
 * browser. Empty string → direct, fully trustless path.
 */
export const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? '').replace(/\/+$/, '')

/**
 * chifra daemon base URL. When set (default: valve's), the app asks the
 * daemon's `/list` endpoint for appearances directly via
 * `@valve-tech/trueblocks-sdk` — instant, no bloom/chunk download at all —
 * and is the preferred source. Set `VITE_CHIFRA_URL=''` to fall back to the
 * backend / direct (trustless browser) paths. NOTE: the browser calls this
 * cross-origin, so the daemon must send permissive CORS.
 */
export const CHIFRA_URL = (
  import.meta.env.VITE_CHIFRA_URL ?? 'https://chifra.valve.city'
).replace(/\/+$/, '')

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
export const MANIFEST_LOOKUP_RPC = 'https://rpc-ethereum.g4mm4.io'

// PulseChain (369) leads — it is the default chain (CHAINS[0]).
export const CHAINS: ChainConfig[] = [
  {
    chainId: 369,
    label: 'PulseChain',
    chainKey: 'pulsechain',
    chifraChain: 'pulsechain',
    rpcUrl: 'https://rpc.pulsechain.com',
    symbol: 'PLS',
    explorerUrl: 'https://explore.valve.city',
  },
  {
    chainId: 943,
    label: 'PulseChain Testnet v4',
    chainKey: 'pulsechain-v4',
    chifraChain: 'pulsechain-v4',
    rpcUrl: 'https://rpc.v4.testnet.pulsechain.com',
    symbol: 'tPLS',
    explorerUrl: 'https://explore.valve.city',
  },
  {
    chainId: 1,
    label: 'Ethereum',
    chainKey: 'mainnet',
    chifraChain: 'mainnet',
    rpcUrl: 'https://rpc-ethereum.g4mm4.io',
    symbol: 'ETH',
    explorerUrl: 'https://explore.valve.city',
  },
]

/**
 * Default scope: the most recent N chunks. Full-history mainnet is
 * hundreds of MB of bloom fetches, so the app bounds to recent activity
 * unless the user opts into "search all history". Per-chunk, not
 * per-block, because chunk block-spans vary wildly across chains.
 */
export const DEFAULT_RECENT_CHUNKS = 6
