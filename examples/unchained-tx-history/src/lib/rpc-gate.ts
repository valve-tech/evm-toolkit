/**
 * One global, adaptive scheduler for the rate-limited public RPC. EVERY tx
 * hydration — across every load card on the page — funnels through this
 * single gate, so the combined request rate stays under the key's limit no
 * matter how many queries run at once (each card otherwise has its own
 * worker pool).
 *
 * The valve `vk_demo` key is ~5 req/s and 5k/day per IP. We pace under the
 * per-second cap and apply backpressure on 429s: slow the steady rate (and
 * honor `Retry-After` when the server sends it), then ease back toward full
 * speed after a run of successes.
 */
const FLOOR_MS = 250 // ~4 req/s at full speed — margin under the ~5/s cap
const CEIL_MS = 3000

let intervalMs = FLOOR_MS
let nextAt = 0
let okStreak = 0

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })

export const rpcGate = {
  /** Resolve when it's this caller's turn, paced at the current rate. */
  async acquire(signal?: AbortSignal): Promise<void> {
    const now = Date.now()
    const at = Math.max(now, nextAt)
    nextAt = at + intervalMs
    const wait = at - now
    if (wait > 0) await sleep(wait, signal)
  },

  /** Apply backpressure after a 429 (optionally honoring Retry-After). */
  throttle(retryAfterMs?: number): void {
    okStreak = 0
    intervalMs = Math.min(Math.round(intervalMs * 1.6), CEIL_MS)
    nextAt = Math.max(nextAt, Date.now() + (retryAfterMs ?? intervalMs))
  },

  /** Ease back toward full speed after sustained success. */
  reward(): void {
    okStreak += 1
    if (okStreak >= 12 && intervalMs > FLOOR_MS) {
      intervalMs = Math.max(FLOOR_MS, Math.round(intervalMs * 0.8))
      okStreak = 0
    }
  },

  /** Current pace, req/s — for display. */
  get rate(): number {
    return Math.round((1000 / intervalMs) * 10) / 10
  },
}
