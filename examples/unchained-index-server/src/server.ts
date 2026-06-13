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
 * memory stays bounded to the warmed bloom set. Deploy where the blooms are
 * local (valve infra / the IPFS pin) and even the first scan is fast.
 *
 * Env: PORT (8788), IPFS_GATEWAY, MANIFEST_RPC.
 */
import { createServer, type ServerResponse } from 'node:http'
import {
  createFetcher,
  createUnchainedReader,
  isReservedAddress,
  parseManifest,
  type ChunkCache,
  type Manifest,
} from '@valve-tech/unchained-reader'
import { encodeAbiParameters, parseAbiParameters, toFunctionSelector, type Hex } from 'viem'

const PORT = Number(process.env.PORT ?? 8788)
const GATEWAY = process.env.IPFS_GATEWAY ?? 'https://ipfs.valve.city'
const MANIFEST_RPC = process.env.MANIFEST_RPC ?? 'https://rpc.valve.city/v1/vk_demo/evm/1'
const UNCHAINED_CONTRACT = '0x0c316b7042b419d07d343f2f4f5bd54ff731183d'
const VALVE_PUBLISHER = '0xEDE750e437251eb69423713D5bE21CbE88116141'
const RECENT_CHUNKS = 6

/**
 * In-memory bloom store. Blooms are cached the moment they're fetched; index
 * chunks are NOT — `put` only stores a CID we've marked as a bloom hash (via
 * the manifest), so the resident set is the bloom set, never the 10s-of-MB
 * index chunks. `get` is what makes a warm query an in-RAM scan.
 */
const bloomCache = new Map<string, Uint8Array>()
const bloomCids = new Set<string>()
const cache: ChunkCache = {
  get: (cid) => Promise.resolve(bloomCache.get(cid)),
  put: (cid, bytes) => {
    if (bloomCids.has(cid)) bloomCache.set(cid, bytes)
    return Promise.resolve()
  },
}
const fetcher = createFetcher({ gatewayUrl: GATEWAY, cache, concurrency: 12 })

const fetchBytes = async (cid: string): Promise<Uint8Array> => {
  const res = await fetch(`${GATEWAY}/ipfs/${cid}`)
  if (!res.ok) throw new Error(`gateway ${cid}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

const MANIFEST_SELECTOR = toFunctionSelector('function manifestHashMap(address,string) returns (string)')
const resolveManifestCid = async (chainKey: string): Promise<string> => {
  const args = encodeAbiParameters(parseAbiParameters('address, string'), [
    VALVE_PUBLISHER as Hex,
    chainKey,
  ])
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
  const hex = (json.result ?? '0x').slice(2)
  const len = parseInt(hex.slice(64, 128), 16)
  const cid = Buffer.from(hex.slice(128, 128 + len * 2), 'hex').toString('utf8')
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
    for (const chunk of manifest.chunks) bloomCids.add(chunk.bloomHash) // mark blooms cacheable
    return manifest
  })()
  manifestCache.set(chainKey, p)
  return p
}

const sse = (res: ServerResponse) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
  })
  return (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
}

const server = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, bloomsInMemory: bloomCache.size }))
    return
  }
  if (url.pathname !== '/appearances') {
    res.writeHead(404)
    res.end('not found')
    return
  }

  const chainKey = url.searchParams.get('chain') ?? ''
  const address = url.searchParams.get('address') ?? ''
  const full = url.searchParams.get('full') === '1'
  const send = sse(res)
  const ac = new AbortController()
  req.on('close', () => ac.abort())

  void (async (): Promise<void> => {
    try {
      if (isReservedAddress(address)) {
        send('error', {
          message: 'address ≤ 0xffff is a precompile / reserved range — not indexed by chifra',
        })
        return
      }
      const manifest = await getManifest(chainKey)
      if (ac.signal.aborted) return

      const scoped: Manifest =
        full || manifest.chunks.length <= RECENT_CHUNKS
          ? manifest
          : { ...manifest, chunks: manifest.chunks.slice(-RECENT_CHUNKS) }

      send('meta', {
        chunks: scoped.chunks.length,
        first: scoped.chunks[0]?.range.first.toString() ?? '0',
        last: scoped.chunks[scoped.chunks.length - 1]?.range.last.toString() ?? '0',
        warm: scoped.chunks.every((c) => bloomCache.has(c.bloomHash)),
      })

      // Single streaming pass: each bloom is fetched (and cached), tested,
      // and only matching index chunks are fetched + parsed — appearances
      // stream out as they're found. No load-everything-first barrier.
      const reader = createUnchainedReader({ fetcher, manifest: scoped })
      const result = await reader.getAppearances(address, {
        signal: ac.signal,
        onProgress: (p) => send('progress', p),
        onAppearances: (found) =>
          send(
            'appearances',
            found.map((a) => ({
              blockNumber: a.blockNumber.toString(),
              transactionIndex: a.transactionIndex.toString(),
            })),
          ),
      })
      if (ac.signal.aborted) return
      send('done', {
        total: result.appearances.length,
        failures: result.failures.map((f) => ({
          first: f.range.first.toString(),
          last: f.range.last.toString(),
          cid: f.cid,
          reason: f.reason,
        })),
      })
    } catch (err) {
      if (!ac.signal.aborted) send('error', { message: err instanceof Error ? err.message : String(err) })
    } finally {
      res.end()
    }
  })()
})

server.listen(PORT, () => {
  console.log(`unchained-index-server listening on :${PORT}  (gateway ${GATEWAY})`)
})
