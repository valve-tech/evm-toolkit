/**
 * Manifest decoding for the Unchained Index.
 *
 * Pure: takes an already-parsed JSON value (the caller does the
 * `JSON.parse` / gateway fetch) and validates it into a typed `Manifest`,
 * converting each chunk's `"first-last"` range string into `bigint`
 * bounds. Unknown spec versions are rejected loudly — the binary chunk
 * format is version-specific, so silently reading a future version could
 * yield wrong appearances with no error (the no-silent-downgrade rule).
 */
import type { Manifest, ChunkRef, BlockRange } from './types.js'

/**
 * The single index format version this reader understands. The chunk and
 * bloom binary layouts in `chunk.ts` / `bloom.ts` are pinned to it. Valve's
 * own pulsechain / pulsechain-v4 manifests and TrueBlocks mainnet all
 * publish this exact string today (verified 2026-06-12).
 */
export const ACCEPTED_VERSION = 'trueblocks-core@v2.0.0-release'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

/** Parse a zero-padded `"000000001-000590510"` range into bigint bounds. */
const parseRange = (raw: unknown): BlockRange => {
  if (typeof raw !== 'string') {
    throw new Error(`manifest: chunk range must be a string, got ${typeof raw}`)
  }
  const m = /^(\d+)-(\d+)$/.exec(raw)
  if (!m) {
    throw new Error(`manifest: malformed chunk range ${JSON.stringify(raw)}`)
  }
  return { first: BigInt(m[1]), last: BigInt(m[2]) }
}

const parseChunk = (raw: unknown, i: number): ChunkRef => {
  if (!isRecord(raw)) {
    throw new Error(`manifest: chunk ${i} is not an object`)
  }
  const { bloomHash, indexHash, bloomSize, indexSize } = raw
  if (typeof bloomHash !== 'string' || typeof indexHash !== 'string') {
    throw new Error(`manifest: chunk ${i} missing bloomHash/indexHash`)
  }
  return {
    range: parseRange(raw.range),
    bloomHash,
    indexHash,
    bloomSize: typeof bloomSize === 'number' ? bloomSize : 0,
    indexSize: typeof indexSize === 'number' ? indexSize : 0,
  }
}

/**
 * Validate and decode an Unchained Index manifest.
 *
 * @param raw a parsed JSON value (object), typically `JSON.parse(text)`
 * @throws if `raw` is not a manifest, the version is unsupported, or any
 *         chunk range is malformed
 */
export const parseManifest = (raw: unknown): Manifest => {
  if (!isRecord(raw)) {
    throw new Error('manifest: expected an object')
  }
  const { version, chain, specification, config, chunks } = raw
  if (typeof version !== 'string') {
    throw new Error('manifest: missing version string')
  }
  if (version !== ACCEPTED_VERSION) {
    throw new Error(
      `manifest: unsupported manifest version ${JSON.stringify(version)} ` +
        `(this reader only supports ${JSON.stringify(ACCEPTED_VERSION)})`,
    )
  }
  if (!Array.isArray(chunks)) {
    throw new Error('manifest: chunks must be an array')
  }
  if (!isRecord(config)) {
    throw new Error('manifest: missing config object')
  }
  return {
    chain: typeof chain === 'string' ? chain : '',
    specification: typeof specification === 'string' ? specification : '',
    version,
    config: {
      appsPerChunk: Number(config.appsPerChunk ?? 0),
      snapToGrid: Number(config.snapToGrid ?? 0),
      firstSnap: Number(config.firstSnap ?? 0),
      unripeDist: Number(config.unripeDist ?? 0),
      ...(typeof config.allowMissing === 'boolean'
        ? { allowMissing: config.allowMissing }
        : {}),
    },
    chunks: chunks.map(parseChunk),
  }
}
