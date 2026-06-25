/**
 * Short-term backend for the unchained-tx-history demo.
 *
 * The trustless browser path must download every chunk's bloom filter to
 * search full history — ~5 GB on a busy chain. This server runs the SAME
 * scan (`@valve-tech/unchained-reader`) but with a key difference: it keeps
 * the blooms in memory across requests. There is NO separate "load
 * everything first" step — it scans straight through, fetching each bloom
 * on the fly, testing it, fetching matching index chunks, and streaming
 * appearances back over SSE as they're found. Fetched blooms are cached as
 * a side effect, so the FIRST query streams while it warms and EVERY later
 * query is an in-RAM scan (microseconds per chunk, no network for blooms).
 *
 * Index chunks (tens of MB each) are never cached — only the blooms — so
 * memory stays bounded to the warmed bloom set (see `bloom-cache.ts`).
 * Deploy where the blooms are local (valve infra / the IPFS pin) and even
 * the first scan is fast.
 *
 * This module is the wire-up only: env config, the manifest resolver, and
 * `server.listen`. The routing + streaming logic lives in `handler.ts`, the
 * cache invariant in `bloom-cache.ts`, and the pure helpers alongside —
 * each unit-tested without binding a port.
 *
 * Env: PORT (8788), IPFS_GATEWAY, MANIFEST_RPC.
 */
import { createServer } from 'node:http'
import { createFetcher, createUnchainedReader, parseManifest, type Manifest } from '@valve-tech/unchained-reader'
import { encodeAbiParameters, parseAbiParameters, toFunctionSelector, type Hex } from 'viem'
import { createBloomCache } from './bloom-cache.js'
import { decodeManifestCid } from './manifest-cid.js'
import { createRequestHandler } from './handler.js'

const PORT = Number(process.env.PORT ?? 8788)
const GATEWAY = process.env.IPFS_GATEWAY ?? 'https://ipfs.valve.city'
const MANIFEST_RPC = process.env.MANIFEST_RPC ?? 'https://rpc.valve.city/v1/vk_demo/evm/1'
const UNCHAINED_CONTRACT = '0x0c316b7042b419d07d343f2f4f5bd54ff731183d'
const VALVE_PUBLISHER = '0xEDE750e437251eb69423713D5bE21CbE88116141'
const RECENT_CHUNKS = 6

const blooms = createBloomCache()
const fetcher = createFetcher({ gatewayUrl: GATEWAY, cache: blooms.cache, concurrency: 12 })

const fetchBytes = async (cid: string): Promise<Uint8Array> => {
  const res = await fetch(`${GATEWAY}/ipfs/${cid}`)
  if (!res.ok) throw new Error(`gateway ${cid}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

const MANIFEST_SELECTOR = toFunctionSelector('function manifestHashMap(address,string) returns (string)')
const resolveManifestCid = async (chainKey: string): Promise<string> => {
  const args = encodeAbiParameters(parseAbiParameters('address, string'), [VALVE_PUBLISHER as Hex, chainKey])
  const res = await fetch(MANIFEST_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: UNCHAINED_CONTRACT, data: MANIFEST_SELECTOR + args.slice(2) }, 'latest'],
    }),
  })
  const json = (await res.json()) as { result?: string; error?: { message: string } }
  if (json.error) throw new Error(`manifest eth_call: ${json.error.message}`)
  const cid = decodeManifestCid(json.result ?? '0x')
  if (!cid) throw new Error(`no manifest published for chain key "${chainKey}"`)
  return cid
}

/** Per-chain manifest, resolved once (cheap: one eth_call + one small fetch). */
const manifestCache = new Map<string, Promise<Manifest>>()
const getManifest = (chainKey: string): Promise<Manifest> => {
  const existing = manifestCache.get(chainKey)
  if (existing) return existing
  const p = (async (): Promise<Manifest> => {
    const cid = await resolveManifestCid(chainKey)
    const manifest = parseManifest(JSON.parse(new TextDecoder().decode(await fetchBytes(cid))))
    blooms.markBlooms(manifest.chunks.map((c) => c.bloomHash)) // mark blooms cacheable
    return manifest
  })()
  manifestCache.set(chainKey, p)
  return p
}

const server = createServer(
  createRequestHandler({
    getManifest,
    runScan: (manifest, address, opts) => createUnchainedReader({ fetcher, manifest }).getAppearances(address, opts),
    blooms,
    recentChunks: RECENT_CHUNKS,
  }),
)

server.listen(PORT, () => {
  console.log(`unchained-index-server listening on :${PORT}  (gateway ${GATEWAY})`)
})
