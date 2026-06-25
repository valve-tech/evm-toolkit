/**
 * Narrow a manifest to the chunks a single query should scan.
 *
 * A full-history scan touches every chunk (~5 GB of blooms on a busy
 * chain). The default query only scans the most recent tail — enough for a
 * "recent activity" view that warms in seconds — and `?full=1` opts into
 * the whole index. A manifest already at or under the tail size is returned
 * unchanged.
 */
import type { Manifest } from '@valve-tech/unchained-reader'

export interface ScopeOptions {
  /** When true, scan the entire manifest instead of just the recent tail. */
  full: boolean
  /** How many trailing chunks the default (non-full) scan covers. */
  recentChunks: number
}

export const scopeManifest = (manifest: Manifest, { full, recentChunks }: ScopeOptions): Manifest => {
  if (full || manifest.chunks.length <= recentChunks) return manifest
  return { ...manifest, chunks: manifest.chunks.slice(-recentChunks) }
}
