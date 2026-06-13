/**
 * Thin JSON-RPC helpers + on-chain manifest resolution + tx hydration.
 *
 * Hydration is plain JSON-RPC (`eth_getTransactionByBlockNumberAndIndex`)
 * so a user can replace the RPC endpoint with any node and run fully
 * trustless — the headline property of this demo. viem is used only to
 * encode/decode the one manifest-lookup `eth_call`.
 */
import {
  encodeAbiParameters,
  decodeAbiParameters,
  parseAbiParameters,
  toFunctionSelector,
  type Hex,
} from 'viem'

import {
  MANIFEST_LOOKUP_RPC,
  UNCHAINED_CONTRACT,
  VALVE_PUBLISHER,
} from '../config'
import type { Appearance } from '@valve-tech/unchained-reader'

/** A hydrated transaction row for the results table. */
export interface TxRow {
  blockNumber: bigint
  transactionIndex: bigint
  hash: string
  from: string
  to: string | null
  value: bigint
}

const rpc = async <T>(url: string, method: string, params: unknown[]): Promise<T> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  })
  if (!res.ok) throw new Error(`RPC ${method}: HTTP ${res.status}`)
  const json = (await res.json()) as { result?: T; error?: { message: string } }
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`)
  return json.result as T
}

const MANIFEST_SELECTOR = toFunctionSelector('function manifestHashMap(address,string) returns (string)')

/**
 * Read the current manifest CID for a chain from the UnchainedIndex
 * contract (on Ethereum) — always fresh, never a stale baked-in value.
 */
export const resolveManifestCid = async (chainKey: string): Promise<string> => {
  const args = encodeAbiParameters(parseAbiParameters('address, string'), [
    VALVE_PUBLISHER as Hex,
    chainKey,
  ])
  const data = (MANIFEST_SELECTOR + args.slice(2)) as Hex
  const result = await rpc<Hex>(MANIFEST_LOOKUP_RPC, 'eth_call', [
    { to: UNCHAINED_CONTRACT, data },
    'latest',
  ])
  const [cid] = decodeAbiParameters(parseAbiParameters('string'), result)
  if (!cid) throw new Error(`no manifest published for chain key "${chainKey}"`)
  return cid
}

/** Latest block number on a chain (for the default "recent" scope). */
export const latestBlock = async (rpcUrl: string): Promise<bigint> =>
  BigInt(await rpc<string>(rpcUrl, 'eth_blockNumber', []))

interface RawTx {
  hash: string
  from: string
  to: string | null
  value: string
}

/** Hydrate one appearance into a full tx row via plain JSON-RPC. */
export const hydrate = async (rpcUrl: string, app: Appearance): Promise<TxRow> => {
  const tx = await rpc<RawTx | null>(rpcUrl, 'eth_getTransactionByBlockNumberAndIndex', [
    `0x${app.blockNumber.toString(16)}`,
    `0x${app.transactionIndex.toString(16)}`,
  ])
  if (!tx) throw new Error(`no tx at block ${app.blockNumber} index ${app.transactionIndex}`)
  return {
    blockNumber: app.blockNumber,
    transactionIndex: app.transactionIndex,
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: BigInt(tx.value),
  }
}
