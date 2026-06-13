/**
 * Custom-RPC support: paste any EVM RPC, detect its chain id over the wire,
 * and fill in the name / symbol / explorer from viem's chain registry (and
 * the icon from gib.show by eip155 id). If the detected id matches one of the
 * built-in indexed chains, the custom entry inherits its index keys so the
 * Unchained Index / chifra source keeps working — it just swaps the RPC used
 * for hydration (e.g. your own node, no rate limit). Custom chains persist in
 * localStorage.
 */
import * as viemChains from 'viem/chains'

import { CHAINS, type ChainConfig } from '../config'

/** Just the fields we read off a viem chain (its full type union is fussy). */
interface ViemChainLite {
  id: number
  name: string
  nativeCurrency: { symbol: string }
  blockExplorers?: { default: { url: string } }
}

const ALL_VIEM_CHAINS = (Object.values(viemChains) as unknown[]).filter(
  (c): c is ViemChainLite =>
    typeof c === 'object' &&
    c !== null &&
    typeof (c as { id?: unknown }).id === 'number' &&
    typeof (c as { name?: unknown }).name === 'string',
)
const viemChainFor = (id: number): ViemChainLite | undefined =>
  ALL_VIEM_CHAINS.find((c) => c.id === id)

const LS_KEY = 'unchained-tx-history.custom-chains'

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
  const indexed = CHAINS.find((c) => c.chainId === chainId) // inherit index keys if known
  const vc = viemChainFor(chainId)

  return {
    chainId,
    label: indexed?.label ?? vc?.name ?? `Chain ${chainId}`,
    chainKey: indexed?.chainKey ?? '',
    chifraChain: indexed?.chifraChain ?? '',
    rpcUrl: url,
    symbol: indexed?.symbol ?? vc?.nativeCurrency.symbol ?? 'ETH',
    explorerUrl: indexed?.explorerUrl ?? vc?.blockExplorers?.default.url ?? '',
  }
}
