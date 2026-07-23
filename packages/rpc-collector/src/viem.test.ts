import { beforeEach, describe, expect, it, vi } from 'vitest';

// Keep viem's real implementation but make `fallback` a spy, so the mode
// tests can assert the exact config this adapter hands to viem.
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return { ...actual, fallback: vi.fn(actual.fallback) };
});

import { fallback } from 'viem';

import { EmptyEndpointSetError, type RpcEndpoint } from './types.js';
import { toViemTransport } from './viem.js';

function endpoint(url: string, protocol: 'http' | 'ws' = 'http'): RpcEndpoint {
  return { url, protocol, tracking: 'none', chainId: 1 };
}

beforeEach(() => {
  vi.mocked(fallback).mockClear();
});

describe('toViemTransport', () => {
  it('builds a fallback transport over every endpoint', () => {
    const transport = toViemTransport([
      endpoint('https://a.example'),
      endpoint('https://b.example'),
    ]);

    const { config, value } = transport({});
    expect(config.type).toBe('fallback');
    expect(value?.transports).toHaveLength(2);
  });

  it('preserves endpoint order in the transport', () => {
    const transport = toViemTransport([
      endpoint('https://first.example'),
      endpoint('https://second.example'),
    ]);

    const urls = transport({}).value?.transports.map((t) => t.value?.url);
    expect(urls).toEqual(['https://first.example', 'https://second.example']);
  });

  it('does not enable ranking in fallback mode', () => {
    toViemTransport([endpoint('https://a.example')], { mode: 'fallback' });
    expect(vi.mocked(fallback).mock.calls[0]?.[1]).toBeUndefined();
  });

  it('defaults to fallback mode', () => {
    toViemTransport([endpoint('https://a.example')]);
    expect(vi.mocked(fallback).mock.calls[0]?.[1]).toBeUndefined();
  });

  it('enables ranking in loadBalance mode', () => {
    toViemTransport([endpoint('https://a.example')], { mode: 'loadBalance' });
    expect(vi.mocked(fallback).mock.calls[0]?.[1]).toEqual({ rank: true });
  });

  it('uses a websocket transport for ws endpoints', () => {
    const transport = toViemTransport([endpoint('wss://a.example', 'ws')]);
    const { value } = transport({});
    expect(value?.transports[0]?.config.type).toBe('webSocket');
  });

  it('throws EmptyEndpointSetError on an empty list', () => {
    expect(() => toViemTransport([])).toThrow(EmptyEndpointSetError);
  });
});
