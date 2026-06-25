import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AppearancesResult, GetAppearancesOptions, Manifest, ChunkRef } from '@valve-tech/unchained-reader'
import { createRequestHandler, type HandlerDeps } from './handler'

/** A valid, non-reserved (> 0xffff) 20-byte address for the happy paths. */
const ADDR = '0x1111111111111111111111111111111111111111'

const chunk = (i: number): ChunkRef => ({
  range: { first: BigInt(i * 100), last: BigInt(i * 100 + 99) },
  bloomHash: `bloom-${i}`,
  bloomSize: 1,
  indexHash: `index-${i}`,
  indexSize: 1,
})

const manifestWith = (count: number): Manifest => ({
  chain: 'test',
  specification: 'spec',
  version: 'trueblocks-core@v2.0.0-release',
  config: { appsPerChunk: 1, snapToGrid: 0, firstSnap: 0, unripeDist: 0 },
  chunks: Array.from({ length: count }, (_, i) => chunk(i)),
})

const emptyResult = (extra?: Partial<AppearancesResult>): AppearancesResult => ({
  address: '0x0000000000000000000000000000000000000001',
  appearances: [],
  failures: [],
  progress: { chunksTotal: 0, bloomsFetched: 0, hits: 0, chunksFetched: 0, appearancesFound: 0, bytesFetched: 0 },
  ...extra,
})

/** One running event for each `event:`/`data:` SSE frame in a body. */
const parseSse = (body: string): { event: string; data: unknown }[] =>
  body
    .split('\n\n')
    .filter((block) => block.includes('event:'))
    .map((block) => {
      const event = /event: (.*)/.exec(block)?.[1] ?? ''
      const data = /data: (.*)/.exec(block)?.[1] ?? 'null'
      return { event, data: JSON.parse(data) }
    })

let server: Server | undefined
afterEach(() => server?.close())

const start = async (deps: Partial<HandlerDeps>): Promise<string> => {
  const full: HandlerDeps = {
    getManifest: () => Promise.resolve(manifestWith(3)),
    runScan: () => Promise.resolve(emptyResult()),
    blooms: { has: () => false, size: () => 0 },
    recentChunks: 6,
    ...deps,
  }
  server = createServer(createRequestHandler(full))
  await new Promise<void>((resolve) => server!.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

describe('request handler routing', () => {
  it('answers OPTIONS preflight with 204 + CORS', async () => {
    const base = await start({})
    const res = await fetch(`${base}/appearances`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('reports resident bloom count on /health', async () => {
    const base = await start({ blooms: { has: () => true, size: () => 7 } })
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, bloomsInMemory: 7 })
  })

  it('404s an unknown path', async () => {
    const base = await start({})
    const res = await fetch(`${base}/nope`)
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('not found')
  })
})

describe('appearances scan stream', () => {
  it('streams meta → appearances → done for a normal address', async () => {
    const seenScanArgs: { address: string; chunks: number } = { address: '', chunks: -1 }
    const runScan = (manifest: Manifest, address: string, opts: GetAppearancesOptions): Promise<AppearancesResult> => {
      seenScanArgs.address = address
      seenScanArgs.chunks = manifest.chunks.length
      opts.onAppearances?.([{ blockNumber: 500n, transactionIndex: 3n }], manifest.chunks[0])
      return Promise.resolve(emptyResult({ appearances: [{ blockNumber: 500n, transactionIndex: 3n }] }))
    }
    const base = await start({
      getManifest: () => Promise.resolve(manifestWith(3)),
      runScan,
      blooms: { has: () => true, size: () => 3 },
    })

    const body = await (await fetch(`${base}/appearances?chain=test&address=${ADDR}`)).text()
    const events = parseSse(body)

    expect(events.map((e) => e.event)).toEqual(['meta', 'appearances', 'done'])
    expect(events[0].data).toMatchObject({ chunks: 3, first: '0', last: '299', warm: true })
    expect(events[1].data).toEqual([{ blockNumber: '500', transactionIndex: '3' }])
    expect(events[2].data).toEqual({ total: 1, failures: [] })
    expect(seenScanArgs).toEqual({ address: ADDR, chunks: 3 })
  })

  it('marks meta.warm false when any in-scope bloom is cold', async () => {
    const base = await start({
      getManifest: () => Promise.resolve(manifestWith(3)),
      blooms: { has: (cid) => cid !== 'bloom-1', size: () => 2 },
    })
    const body = await (await fetch(`${base}/appearances?chain=test&address=${ADDR}`)).text()
    const meta = parseSse(body).find((e) => e.event === 'meta')
    expect(meta?.data).toMatchObject({ warm: false })
  })

  it('scans the full index when ?full=1, only the recent tail otherwise', async () => {
    const widths: number[] = []
    const runScan = (manifest: Manifest): Promise<AppearancesResult> => {
      widths.push(manifest.chunks.length)
      return Promise.resolve(emptyResult())
    }
    const base = await start({ getManifest: () => Promise.resolve(manifestWith(20)), runScan, recentChunks: 6 })

    await (await fetch(`${base}/appearances?chain=test&address=${ADDR}`)).text()
    await (await fetch(`${base}/appearances?chain=test&address=${ADDR}&full=1`)).text()
    expect(widths).toEqual([6, 20])
  })

  it('rejects a reserved/precompile address before resolving a manifest', async () => {
    let manifestResolved = false
    const base = await start({
      getManifest: () => {
        manifestResolved = true
        return Promise.resolve(manifestWith(3))
      },
    })
    const body = await (await fetch(`${base}/appearances?chain=test&address=0x0000000000000000000000000000000000000005`)).text()
    const events = parseSse(body)
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('error')
    expect(events[0].data).toMatchObject({ message: expect.stringContaining('reserved range') })
    expect(manifestResolved).toBe(false)
  })

  it('emits an error event when manifest resolution throws', async () => {
    const base = await start({
      getManifest: () => Promise.reject(new Error('no manifest published for chain key "ghost"')),
    })
    const body = await (await fetch(`${base}/appearances?chain=ghost&address=${ADDR}`)).text()
    const events = parseSse(body)
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('error')
    expect(events[0].data).toEqual({ message: 'no manifest published for chain key "ghost"' })
  })

  it('serializes chunk failures in the done event', async () => {
    const runScan = (): Promise<AppearancesResult> =>
      Promise.resolve(
        emptyResult({
          failures: [{ range: { first: 100n, last: 199n }, cid: 'QmBad', reason: 'fetch', detail: 'HTTP 504' }],
        }),
      )
    const base = await start({ runScan })
    const body = await (await fetch(`${base}/appearances?chain=test&address=${ADDR}`)).text()
    const done = parseSse(body).find((e) => e.event === 'done')
    expect(done?.data).toEqual({
      total: 0,
      failures: [{ first: '100', last: '199', cid: 'QmBad', reason: 'fetch' }],
    })
  })
})
