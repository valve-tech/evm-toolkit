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

/** Thrown when the rate-limited RPC returns 429, so the caller can back off. */
export class RpcRateLimitError extends Error {
  readonly retryAfterMs?: number
  constructor(retryAfterMs?: number) {
    super('rate limited (HTTP 429)')
    this.name = 'RpcRateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

/** One entry of a JSON-RPC batch response for the hydration calls. */
export interface BatchResponseItem {
  id: number
  result?: RawTx | null
  error?: { message: string }
}

/**
 * Pure: fold a JSON-RPC batch response back onto the appearances it was built
 * from. Each sub-request's `id` is the index of its appearance, so results are
 * matched by id — JSON-RPC does not guarantee response order, and a custom RPC
 * may reorder. A null result (no tx at that block/index), an error entry, or a
 * missing id routes that appearance to `failed` for the caller to retry or
 * mark unavailable. Surviving entries become rows carrying the appearance's
 * authoritative block/index plus the tx's hash/from/to/value.
 */
export const foldBatchTxResponse = (
  apps: Appearance[],
  items: BatchResponseItem[],
): { rows: TxRow[]; failed: Appearance[] } => {
  const byId = new Map<number, BatchResponseItem>()
  for (const item of items) byId.set(item.id, item)

  const rows: TxRow[] = []
  const failed: Appearance[] = []
  apps.forEach((app, id) => {
    const item = byId.get(id)
    const tx = item?.result
    if (!item || item.error || !tx) {
      failed.push(app)
      return
    }
    rows.push({
      blockNumber: app.blockNumber,
      transactionIndex: app.transactionIndex,
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: BigInt(tx.value),
    })
  })
  return { rows, failed }
}

/**
 * Hydrate a batch of appearances in ONE JSON-RPC batch request — an array of
 * `eth_getTransactionByBlockNumberAndIndex` calls keyed by appearance index.
 * Collapses N round trips into one HTTP request (the daemon's `chifra
 * transactions` is far too slow for this; lean per-tx RPC, batched, is the
 * fast path). Returns the hydrated rows, the appearances that came back
 * empty/errored (for the caller to retry), and the bytes this response cost.
 * A 429 on the batch throws {@link RpcRateLimitError} so the whole batch backs
 * off and is retried together.
 */
export const hydrateBatch = async (
  rpcUrl: string,
  apps: Appearance[],
): Promise<{ rows: TxRow[]; failed: Appearance[]; bytes: number }> => {
  const body = apps.map((app, id) => ({
    jsonrpc: '2.0',
    id,
    method: 'eth_getTransactionByBlockNumberAndIndex',
    params: [`0x${app.blockNumber.toString(16)}`, `0x${app.transactionIndex.toString(16)}`],
  }))
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 429) {
    const ra = res.headers.get('retry-after')
    throw new RpcRateLimitError(ra ? Number(ra) * 1000 : undefined)
  }
  if (!res.ok) throw new Error(`hydrateBatch: HTTP ${res.status}`)
  const text = await res.text()
  const bytes = new TextEncoder().encode(text).length
  const parsed = JSON.parse(text) as unknown
  const items = Array.isArray(parsed) ? (parsed as BatchResponseItem[]) : []
  const { rows, failed } = foldBatchTxResponse(apps, items)
  return { rows, failed, bytes }
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
  if (res.status === 429) {
    const ra = res.headers.get('retry-after')
    throw new RpcRateLimitError(ra ? Number(ra) * 1000 : undefined)
  }
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
