/**
 * Build-time configuration. Everything here is PUBLIC — a static site
 * holds no secrets. The bundler/paymaster URLs are editable at runtime
 * in the UI; these are just defaults.
 *
 * The account model is a Coinbase Smart Account v1 on EntryPoint 0.6 —
 * production-deployed on mainnet + major testnets, and reproducible on
 * a local anvil via scripts/anvil-aa-fixture.sh.
 */
export interface AaChainConfig {
  chainId: number
  label: string
  rpcUrl: string
  symbol: string
  /** Default ERC-4337 bundler RPC for this chain ('' = paste your own). */
  bundlerUrl: string
  explorerUrl: string
}

export const CHAINS: AaChainConfig[] = [
  {
    chainId: 31337,
    label: 'Anvil (local fixture)',
    rpcUrl: 'http://127.0.0.1:8545',
    symbol: 'ETH',
    bundlerUrl: 'http://127.0.0.1:4337',
    explorerUrl: '',
  },
  {
    chainId: 11155111,
    label: 'Sepolia',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    symbol: 'ETH',
    bundlerUrl: '',
    explorerUrl: 'https://sepolia.etherscan.io',
  },
]
