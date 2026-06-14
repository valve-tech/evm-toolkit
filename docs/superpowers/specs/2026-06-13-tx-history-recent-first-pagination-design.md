# tx-history — recent-first loading, "load more" pagination, cost observability — design spec

**Date:** 2026-06-13
**Status:** Drafted for maintainer review
**Scope:** `examples/unchained-tx-history` only — no published-package changes.

## Goal

Three behaviours for the `unchained-tx-history` example:

1. **Most recent transactions load and display first.** Today every source
   yields appearances oldest-first (chifra pages `firstRecord=0` forward; the
   trustless bloom scan walks chunks in ascending block order). The table
   *displays* newest-first (`sortKey='block'`, `desc=true`) but the *data is
   loaded* oldest-first — so the first thing to paint is the oldest activity.
2. **Bounded, on-demand loading via a "load more" button.** Today hydration is
   eager and unbounded: `LoadCard` pushes every found appearance into the queue
   and the workers hydrate all of them. For a busy address that is thousands of
   `eth_getTransactionByBlockNumberAndIndex` calls dripping through the
   `vk_demo` rate gate (~5 req/s) and thousands of `<tr>` in the DOM, mostly for
   rows nobody scrolls to.
3. **Cost observability — timing + wire-size on hover.** The app already shows
   cumulative bytes-over-the-wire and RPC-call counts, but not *timing*, and not
   broken down per phase or per page. Surface the cost of loading this data —
   **time and bytes** — as hover tooltips at a few deliberate points, so the UX
   cost of each path/page is visible.

Behaviours 1 and 2 are the same feature: to load newest-first we must drive each
source from the newest end; once we do, "load more" is just "pull the next
(older) page." Behaviour 3 rides on the same change — each page is a natural unit
to time and measure.

## Non-goals

- No virtualised table. Pages of 50 keep the DOM small enough without it.
- No change to `@valve-tech/unchained-reader`, `@valve-tech/trueblocks-sdk`, or
  the index-server. Everything is implementable in the example using APIs those
  packages already expose.
- Not touching sorting within a loaded set (still block/value, client-side).

## Feasibility (verified against current package surfaces)

- **chifra `/list`** exposes `reversed?: boolean` ("produce results in reverse
  chronological order") plus `firstRecord`/`maxRecords` and `count?: boolean`.
  So `reversed: true` makes record 0 the newest and paging forward walks back in
  time; `count: true` returns the exact total in one cheap call. The SDK's
  `client.list(...)` forwards arbitrary typed query params, so no SDK change.
- **`@valve-tech/unchained-reader`** `getAppearances(addr, { blockRange })`
  already filters chunks to a block range. Reverse pagination = call it with
  successive *older* block-range windows, newest window first. No reader change.
  (Note: the reader fans out over all in-scope chunks with `Promise.all`, so it
  cannot pause mid-scan — but per-window calls give us the page boundary we need
  without modifying it.)
- **backend (SSE)** streams the full set server-side in one shot. We buffer it
  client-side, sort newest-first, and slice pages from memory. No server change.

## Architecture: fire-once scan → pull-based cursor

Replace the fire-once `StreamQuery` contract with a **pull-based appearance
cursor**. This is the one abstraction that unifies all three sources behind
"give me the next page of newest appearances."

```ts
export interface AppearancePage {
  /** This page's appearances, already ordered NEWEST-first. */
  appearances: Appearance[]
  /** True when the source is exhausted — no more pages exist. */
  done: boolean
}

export interface AppearanceCursor {
  /** Pull the next page of newest-not-yet-seen appearances. */
  next(): Promise<AppearancePage>
  /** Scanned window + accumulated failures so far (for partial-result UI). */
  outcome(): QueryOutcome
  /** Exact total if the source knows it cheaply (chifra), else null. */
  total: number | null
}

export type CreateCursor = (
  chain: ChainConfig,
  address: string,
  scope: QueryScope,
  handlers: CursorHandlers, // onProgress / onStatus / onWire (no onAppearances — pull, not push)
  signal: AbortSignal,
) => Promise<AppearanceCursor>
```

`PAGE_SIZE = 50` (initial page and "load more" increment).

### Per-source `next()` semantics

- **chifra** (`createChifraCursor`): on creation, one `list({ count: true })`
  call sets `total`. Each `next()` issues
  `list({ reversed: true, firstRecord: cursor, maxRecords: PAGE_SIZE })`,
  advances `cursor += PAGE_SIZE`, maps records to `Appearance[]`, and reports
  `done` when a short page comes back. `total` is non-null.
- **trustless** (`createDirectCursor`): resolve manifest + chunk list once; keep
  the in-scope chunks reversed (newest range first) and a chunk index. Each
  `next()` walks forward through the reversed chunk list, calling
  `reader.getAppearances(addr, { blockRange: <that chunk's range> })`
  per chunk, accumulating appearances until it has `>= PAGE_SIZE` or the chunk
  list is exhausted; returns the accumulated appearances sorted newest-first and
  `done` when no chunks remain. `total` is null. Failures from each window
  accumulate into `outcome()`.
- **backend** (`createBackendCursor`): on first `next()`, drain the whole SSE
  stream into a buffer, sort newest-first, cache it; each `next()` slices the
  next `PAGE_SIZE`. `total` is the buffered length after the first pull
  (so it can show `N of TOTAL` once the stream completes), `done` on the last
  slice.

The existing source-selection logic (`CHIFRA_URL ? chifra : BACKEND_URL ?
backend : direct`) chooses which cursor factory to use — unchanged.

## LoadCard changes

`LoadCard` keeps owning all of its own state and running once on mount, but the
worker model changes from "drain an unbounded queue" to "hydrate exactly the
pages the cursor has handed us":

1. **On mount:** `await createCursor(...)`, then pull + hydrate page 1.
2. **Hydrate a page:** feed the page's (already newest-first) appearances through
   the existing batched-RPC hydration (`hydrateBatch`, `BATCH_SIZE=16`,
   `HYDRATE_CONCURRENCY=4`, global `rpcGate` pacing + 429 backpressure — all
   unchanged). Rows append in newest-first order.
3. **"Load 50 more" button** under the table: disabled while a page is
   hydrating; pulls the next page and hydrates it; appended below. Hidden once
   the last page reported `done`.
4. **Counts:**
   - chifra: header + table show `N of TOTAL loaded` (TOTAL from `cursor.total`).
   - trustless/backend: show `N loaded` with the load-more affordance; no fake
     total (consistent with the toolkit's no-silent-downgrade ethos). Once a
     backend stream completes, `total` becomes known and the label upgrades.

The two-step progress UI ("Finding appearances" / "Loading transactions") and
the trustless stat grid (chunks/blooms/hits/parsed) remain; "Finding
appearances" now reflects per-page scanning rather than one exhaustive scan.

### The `fullHistory` toggle becomes redundant

With pagination, the initial load is *always* bounded to the newest page and
load-more walks back on demand — so the explicit "search all history" toggle no
longer gates cost. **Recommendation: remove the toggle** and let load-more be
the bound; the "scanned window" line still tells the user how far back they have
covered. (Flagged for maintainer veto at spec review — keeping it is possible
but it would be vestigial.)

## Cost observability — timing + wire-size on hover

Reuse the existing `data-tip` hover-tooltip pattern (already on `.stat` cells and
the history toggle) — no new tooltip mechanism. Timing uses `performance.now()`
in the browser (no new dependency).

**What we record** (in `LoadCard` state), per page and accumulated:

- **Per page** `{ pageIndex, count, findMs, hydrateMs, bytes, rpcCalls }`:
  - `findMs` — time from `cursor.next()` call to its appearances returning
    (the scan/list cost for that page).
  - `hydrateMs` — time from page appearances arriving to the last row in the
    page settling.
  - `bytes` — bytes over the wire attributable to that page: snapshot the global
    byte counters (`clientExtra` + trustless `progress.bytesFetched`) at the
    page's start and end and diff.
  - `rpcCalls` — `rpcCalls` counter delta across the page.
- **Cumulative** — totals + a split of total time into "finding" vs "hydrating".

**Hover points** (deliberately few — cost where the user is already looking):

1. **The "Load 50 more" button** — tooltip shows the *last* page's cost
   ("Page 3 · 1.2 s · 84 KB · 4 RPC calls") so the user sees what one more click
   just cost / will cost.
2. **The metrics row** (already shows bytes + RPC) — add an **elapsed-time**
   figure; its tooltip decomposes total time into finding vs hydrating, and
   repeats the byte split already shown.
3. **The two progress-step rows** ("Finding appearances" / "Loading
   transactions") — each gains a tooltip with that phase's elapsed time
   (cumulative across pages).

No per-row timing and no always-on per-page clutter in the table — the data is
on hover, off by default, matching the existing stat-grid affordance.

## Rendering

`ResultsTable` already sorts newest-first by default and renders `order`. With
pages it renders exactly the hydrated rows (≤ pages pulled × 50), so no
virtualisation is needed. The "Load 50 more" button lives just below the table
(in `LoadCard`, passed the disabled/hidden state).

## Error handling / partial results

Unchanged in spirit: per-page failures accumulate into `outcome().failures` and
render in the existing "N chunks could not be read" panel. A page that fails to
fetch surfaces its error; load-more remains available for subsequent pages
(a single bad chunk window does not kill the whole card).

## Testing

- **Cursor unit tests** (new, per source) with injected fakes:
  - chifra: fake `list` asserts `reversed: true`, correct `firstRecord`
    advancement, `count` wired to `total`, short-page → `done`.
  - trustless: fake reader asserts newest-window-first walk, accumulation to
    `>= PAGE_SIZE`, `done` on chunk exhaustion, failures surfaced.
  - backend: fake SSE buffer asserts newest-first slice ordering + `done`.
- **Cost-accounting** is pure where it matters: factor per-page cost derivation
  (start/end counter snapshots → `{ findMs, hydrateMs, bytes, rpcCalls }`) into a
  small pure helper with a unit test, so timing/byte attribution is verified
  without a browser. The `performance.now()` reads stay at the call sites.
- **Existing tests** (`rpc.test.ts`, `format.test.ts`) unchanged; `hydrateBatch`
  and the rate gate are untouched.
- **Manual end-to-end** before merge (per the contributing skill — don't claim
  an example works without running it): 943 sample loads newest-first, "load
  more" pulls older rows, chifra shows `N of TOTAL`, trustless shows `N loaded`.

## Acceptance

- [ ] First page that paints is the **newest** transactions on every source.
- [ ] A "Load 50 more" button hydrates the next-older page on demand and hides
      when exhausted.
- [ ] chifra header reads `N of TOTAL`; trustless/backend read `N loaded`.
- [ ] No eager hydration of an address's full history — RPC calls scale with
      pages pulled, not total appearances.
- [ ] Hover on the load-more button shows the last page's time + bytes + RPC
      calls; the metrics row shows elapsed time with a finding-vs-hydrating
      split on hover; each progress step shows its phase time on hover.
- [ ] `yarn verify:clean` green at repo root (build/lint/typecheck/test).
- [ ] Manual end-to-end run on 943 confirms the above in a real browser.
