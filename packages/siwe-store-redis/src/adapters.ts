/**
 * @fileoverview Client adapters onto the `RedisClientLike` surface.
 *
 * node-redis **v4** matches `RedisClientLike` structurally — pass the
 * client straight in, no adapter. These two adapters cover the other
 * major client signatures, each typed against the minimal structural
 * shape of its target so the package still imports neither library.
 */

import type { RedisClientLike, RedisSetOptions } from './types.js'

/** The subset of a node-redis v5 client the adapter consumes. */
export interface NodeRedisV5Like {
  set(
    key: string,
    value: string,
    options?: { expiration?: { type: 'PX'; value: number } },
  ): Promise<unknown>
  get(key: string): Promise<string | null>
  del(key: string): Promise<number>
}

/**
 * Adapt a node-redis **v5** client — v5 moved SET's TTL options under
 * an `expiration` object, so `{ PX }` maps onto
 * `{ expiration: { type: 'PX', value } }`.
 */
export function fromNodeRedisV5(client: NodeRedisV5Like): RedisClientLike {
  return {
    set: (key, value, options?: RedisSetOptions) =>
      client.set(
        key,
        value,
        options?.PX === undefined
          ? undefined
          : { expiration: { type: 'PX', value: options.PX } },
      ),
    get: (key) => client.get(key),
    del: (key) => client.del(key),
  }
}

/** The subset of an ioredis client the adapter consumes. */
export interface IoRedisLike {
  set(
    key: string,
    value: string,
    px?: 'PX',
    milliseconds?: number,
  ): Promise<unknown>
  get(key: string): Promise<string | null>
  del(key: string): Promise<number>
}

/**
 * Adapt an ioredis client — ioredis takes SET options as positional
 * arguments, so `{ PX }` maps onto `('PX', milliseconds)`.
 */
export function fromIoRedis(client: IoRedisLike): RedisClientLike {
  return {
    set: (key, value, options?: RedisSetOptions) =>
      options?.PX === undefined
        ? client.set(key, value)
        : client.set(key, value, 'PX', options.PX),
    get: (key) => client.get(key),
    del: (key) => client.del(key),
  }
}
