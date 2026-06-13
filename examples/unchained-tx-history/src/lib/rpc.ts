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

/** A hydrated row plus the bytes its RPC response cost over the wire. */
export interface Hydrated {
  row: TxRow
  bytes: number
}

/**
 * Hydrate one appearance into a full tx row via plain JSON-RPC. Reads the
 * raw response text so the caller can account for the actual bytes this
 * browser pulled over the wire (the only client-side download in backend
 * mode, alongside the SSE stream).
 */
export const hydrate = async (rpcUrl: string, app: Appearance): Promise<Hydrated> => {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionByBlockNumberAndIndex',
      params: [`0x${app.blockNumber.toString(16)}`, `0x${app.transactionIndex.toString(16)}`],
    }),
  })
  if (!res.ok) throw new Error(`hydrate: HTTP ${res.status}`)
  const text = await res.text()
  const bytes = new TextEncoder().encode(text).length
  const json = JSON.parse(text) as { result?: RawTx | null; error?: { message: string } }
  if (json.error) throw new Error(`hydrate: ${json.error.message}`)
  const tx = json.result
  if (!tx) throw new Error(`no tx at block ${app.blockNumber} index ${app.transactionIndex}`)
  return {
    row: {
      blockNumber: app.blockNumber,
      transactionIndex: app.transactionIndex,
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: BigInt(tx.value),
    },
    bytes,
  }
}
