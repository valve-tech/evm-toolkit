/**
 * Tests for the client adapters — each maps `RedisClientLike`'s
 * `{ PX }` set-options onto the target client's own signature and
 * passes get/del through untouched.
 */

import { describe, expect, it, vi } from 'vitest'

import { fromIoRedis, fromNodeRedisV5 } from './adapters.js'

describe('fromNodeRedisV5', () => {
  it('maps PX onto the v5 expiration option and passes get/del through', async () => {
    const set = vi.fn(async () => 'OK')
    const get = vi.fn(async () => 'value')
    const del = vi.fn(async () => 1)

    const client = fromNodeRedisV5({ set, get, del })

    await client.set('k', 'v', { PX: 1234 })
    expect(set).toHaveBeenCalledWith('k', 'v', {
      expiration: { type: 'PX', value: 1234 },
    })

    await client.set('k2', 'v2')
    expect(set).toHaveBeenCalledWith('k2', 'v2', undefined)

    expect(await client.get('k')).toBe('value')
    expect(get).toHaveBeenCalledWith('k')
    expect(await client.del('k')).toBe(1)
    expect(del).toHaveBeenCalledWith('k')
  })
})

describe('fromIoRedis', () => {
  it('maps PX onto ioredis positional args and passes get/del through', async () => {
    const set = vi.fn(async () => 'OK')
    const get = vi.fn(async () => 'value')
    const del = vi.fn(async () => 1)

    const client = fromIoRedis({ set, get, del })

    await client.set('k', 'v', { PX: 1234 })
    expect(set).toHaveBeenCalledWith('k', 'v', 'PX', 1234)

    await client.set('k2', 'v2')
    expect(set).toHaveBeenCalledWith('k2', 'v2')

    expect(await client.get('k')).toBe('value')
    expect(get).toHaveBeenCalledWith('k')
    expect(await client.del('k')).toBe(1)
    expect(del).toHaveBeenCalledWith('k')
  })
})
