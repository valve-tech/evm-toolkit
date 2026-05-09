/**
 * Variant accessors for `/chunks`. Unlike most chifra endpoints,
 * `/chunks` selects its output via a `mode` enum (not boolean
 * flags). Each variant preselects a mode and narrows the return.
 *
 * Skipped for v1 (need flag-combination investigation): the Go
 * SDK's `ChunksDiff`, `ChunksList`, `ChunksCount`, `ChunksPinsList`.
 * Callers needing those can use the polymorphic base call.
 */
import type { RequestFn } from '../client.js'
import type { components } from '../generated.js'
import { makeVerb, type Query, type VerbFn } from '../verbs.js'

type ChunksQuery = Query<'/chunks'>
type Envelope<T> = { data?: T[] }

export interface ChunksVerb extends VerbFn<'/chunks'> {
  /** `?mode=manifest` — the chain manifest. */
  manifest: (
    query: Omit<ChunksQuery, 'mode'>,
  ) => Promise<Envelope<components['schemas']['manifest']>>
  /** `?mode=index` — index chunk records. */
  index: (
    query: Omit<ChunksQuery, 'mode'>,
  ) => Promise<Envelope<components['schemas']['chunkIndex']>>
  /** `?mode=blooms` — bloom filter chunks. */
  blooms: (
    query: Omit<ChunksQuery, 'mode'>,
  ) => Promise<Envelope<components['schemas']['chunkBloom']>>
  /** `?mode=pins` — pinned chunks. */
  pins: (
    query: Omit<ChunksQuery, 'mode'>,
  ) => Promise<Envelope<components['schemas']['chunkPin']>>
  /** `?mode=addresses` — addresses contained in the chunk(s). */
  addresses: (
    query: Omit<ChunksQuery, 'mode'>,
  ) => Promise<Envelope<components['schemas']['chunkAddress']>>
  /** `?mode=appearances` — appearance entries within chunks. */
  appearances: (
    query: Omit<ChunksQuery, 'mode'>,
  ) => Promise<Envelope<components['schemas']['appearanceTable']>>
  /** `?mode=stats` — chunk statistics. */
  stats: (
    query: Omit<ChunksQuery, 'mode'>,
  ) => Promise<Envelope<components['schemas']['chunkStats']>>
}

type ChunkMode = ChunksQuery extends { mode: infer M } ? M : never

export function makeChunksVerb(request: RequestFn): ChunksVerb {
  const base = makeVerb(request, '/chunks')

  const variant = (mode: ChunkMode) =>
    (query: Omit<ChunksQuery, 'mode'>) =>
      base({ ...(query as ChunksQuery), mode }) as Promise<unknown>

  return Object.assign(base, {
    manifest: variant('manifest'),
    index: variant('index'),
    blooms: variant('blooms'),
    pins: variant('pins'),
    addresses: variant('addresses'),
    appearances: variant('appearances'),
    stats: variant('stats'),
  }) as ChunksVerb
}
