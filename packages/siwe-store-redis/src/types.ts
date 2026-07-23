/**
 * @fileoverview The minimal Redis command surface the stores need.
 *
 * The stores type against this structural interface rather than a
 * concrete client library, so the package carries **zero runtime
 * dependencies** and works with any client that can satisfy three
 * commands. node-redis v4 satisfies it directly; `fromNodeRedisV5`
 * and `fromIoRedis` (see `adapters.ts`) map the other two major
 * clients onto it.
 */

/** Options for {@link RedisClientLike.set}. */
export interface RedisSetOptions {
  /**
   * TTL in milliseconds (Redis `PX`). The client MUST apply this as a
   * server-side expiry — the stores never re-check TTLs client-side;
   * Redis expiry is the single source of truth.
   */
  PX?: number
}

/**
 * The three Redis commands the stores use.
 *
 * - `set` writes a string value, applying `options.PX` as a
 *   server-side TTL when present.
 * - `get` reads a live value or resolves `null` (missing or expired).
 * - `del` deletes and resolves the number of keys removed — its
 *   atomic "did I win" count is the single-use nonce primitive.
 */
export interface RedisClientLike {
  set(
    key: string,
    value: string,
    options?: RedisSetOptions,
  ): Promise<unknown>
  get(key: string): Promise<string | null>
  del(key: string): Promise<number>
}
