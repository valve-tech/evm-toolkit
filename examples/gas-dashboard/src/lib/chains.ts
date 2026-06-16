/**
 * Custom-RPC support: paste any EVM RPC, detect its chain id over the wire,
 * fill in name/symbol from viem's chain registry. If the detected id matches
 * a built-in chain, inherit its label/symbol/explorer. Custom chains persist
 * in localStorage.
 */
import { CHAINS, type ChainConfig } from '../config'

interface ViemChainLite {
  id: number
  name: string
  nativeCurrency: { symbol: string }
  blockExplorers?: { default: { url: string } }
}

// viem/chains is large — load it lazily so it splits into its own chunk.
let viemChainsCache: ViemChainLite[] | null = null
const viemChainFor = async (id: number): Promise<ViemChainLite | undefined> => {
  if (!viemChainsCache) {
    const mod = await import('viem/chains')
    viemChainsCache = (Object.values(mod) as unknown[]).filter(
      (c): c is ViemChainLite =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as { id?: unknown }).id === 'number' &&
        typeof (c as { name?: unknown }).name === 'string',
    )
  }
  return viemChainsCache.find((c) => c.id === id)
}

const LS_KEY = 'gas-dashboard.custom-chains'

export const loadCustomChains = (): ChainConfig[] => {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as ChainConfig[]) : []
  } catch {
    return []
  }
}

export const saveCustomChains = (chains: ChainConfig[]): void => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(chains))
  } catch {
    /* private mode / quota — non-fatal */
  }
}

/** Ask an RPC for its chain id, then build a ChainConfig around it. */
export const detectChain = async (rpcUrl: string): Promise<ChainConfig> => {
  const url = rpcUrl.trim()
  if (/^wss?:\/\//i.test(url)) {
    throw new Error('Paste an http(s) RPC to detect the chain; switch to ws:// only after selecting it.')
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  })
  if (!res.ok) throw new Error(`RPC responded ${res.status}`)
  const json = (await res.json()) as { result?: string; error?: { message: string } }
  if (json.error) throw new Error(json.error.message)
  if (!json.result) throw new Error('RPC did not return a chain id')

  const chainId = Number(BigInt(json.result))
  const known = CHAINS.find((c) => c.chainId === chainId)
  const vc = await viemChainFor(chainId)

  return {
    chainId,
    label: known?.label ?? vc?.name ?? `Chain ${chainId}`,
    rpcUrl: url,
    symbol: known?.symbol ?? vc?.nativeCurrency.symbol ?? 'ETH',
    explorerUrl: known?.explorerUrl ?? vc?.blockExplorers?.default.url ?? '',
  }
}
