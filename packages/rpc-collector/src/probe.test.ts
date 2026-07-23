import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeEndpoints } from './probe.js';
import type { RpcEndpoint } from './types.js';

function endpoint(url: string, protocol: 'http' | 'ws' = 'http'): RpcEndpoint {
  return { url, protocol, tracking: 'none', chainId: 1 };
}

/** Resolve a JSON-RPC chainId reply after `delayMs`. */
function replyWithChainId(hexChainId: string, delayMs: number) {
  return () =>
    new Promise((resolve) => {
      setTimeout(
        () =>
          resolve({
            ok: true,
            json: async () => ({ jsonrpc: '2.0', id: 1, result: hexChainId }),
          }),
        delayMs,
      );
    });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('probeEndpoints', () => {
  it('orders live endpoints by latency', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(replyWithChainId('0x1', 50))
      .mockImplementationOnce(replyWithChainId('0x1', 5));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeEndpoints([
      endpoint('https://slow.example'),
      endpoint('https://fast.example'),
    ]);

    expect(result.map((e) => e.url)).toEqual([
      'https://fast.example',
      'https://slow.example',
    ]);
    expect(result.every((e) => e.alive)).toBe(true);
    expect(result[0]?.latencyMs).not.toBeNull();
  });

  it('drops endpoints that fail to respond', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')))
      .mockImplementationOnce(replyWithChainId('0x1', 1));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeEndpoints([
      endpoint('https://dead.example'),
      endpoint('https://live.example'),
    ]);

    expect(result.map((e) => e.url)).toEqual(['https://live.example']);
  });

  it('drops endpoints that report the wrong chainId', async () => {
    const fetchMock = vi.fn().mockImplementation(replyWithChainId('0x89', 1));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeEndpoints([endpoint('https://wrong.example')]);

    expect(result).toEqual([]);
  });

  it('keeps dead endpoints, flagged, when keepDead is set', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeEndpoints([endpoint('https://dead.example')], {
      keepDead: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.alive).toBe(false);
    expect(result[0]?.latencyMs).toBeNull();
  });

  it('passes websocket endpoints through unprobed, after measured ones', async () => {
    const fetchMock = vi.fn().mockImplementation(replyWithChainId('0x1', 1));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeEndpoints([
      endpoint('wss://ws.example', 'ws'),
      endpoint('https://http.example'),
    ]);

    expect(result.map((e) => e.url)).toEqual([
      'https://http.example',
      'wss://ws.example',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result[1]?.latencyMs).toBeNull();
    expect(result[1]?.alive).toBe(true);
  });

  it('returns an empty array for an empty input', async () => {
    await expect(probeEndpoints([])).resolves.toEqual([]);
  });
});
