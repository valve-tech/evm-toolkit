/**
 * Pull-based appearance source. The UI asks for one page at a time instead of
 * the source streaming its entire result up front — so a whale with thousands
 * of appearances costs a cheap `count` plus the pages actually shown, not its
 * whole coordinate list.
 */
import type { Appearance } from '@valve-tech/unchained-reader'

import type { QueryOutcome } from './history'

export type SortOrder = 'newest' | 'oldest'

export interface AppearancePage {
  /** Appearances for this page, already in the cursor's sort order. */
  appearances: Appearance[]
  /** True once the source has no more pages. */
  done: boolean
}

export interface AppearanceCursor {
  /** Exact total if known cheaply (chifra `count`), else null. */
  readonly total: number | null
  /** Pull the next `pageSize` appearances. */
  next(pageSize: number): Promise<AppearancePage>
  /** Scanned window + failures accumulated so far. */
  outcome(): QueryOutcome
}
