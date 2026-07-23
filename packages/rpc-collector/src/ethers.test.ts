import { FallbackProvider } from 'ethers';
import { describe, expect, it } from 'vitest';

import { toEthersProvider } from './ethers.js';
import { EmptyEndpointSetError, type RpcEndpoint } from './types.js';

function endpoint(url: string, protocol: 'http' | 'ws' = 'http'): RpcEndpoint {
  return { url, protocol, tracking: 'none', chainId: 1 };
}

describe('toEthersProvider', () => {
  it('builds a FallbackProvider over every endpoint', () => {
    const provider = toEthersProvider([
      endpoint('https://a.example'),
      endpoint('https://b.example'),
    ]);

    expect(provider).toBeInstanceOf(FallbackProvider);
    expect(provider.providerConfigs).toHaveLength(2);
  });

  it('assigns ascending priority in fallback mode', () => {
    const provider = toEthersProvider(
      [endpoint('https://a.example'), endpoint('https://b.example')],
      { mode: 'fallback' },
    );

    const priorities = provider.providerConfigs.map((c) => c.priority);
    expect(priorities).toEqual([1, 2]);
  });

  it('assigns equal priority in loadBalance mode', () => {
    const provider = toEthersProvider(
      [endpoint('https://a.example'), endpoint('https://b.example')],
      { mode: 'loadBalance' },
    );

    const priorities = provider.providerConfigs.map((c) => c.priority);
    expect(priorities).toEqual([1, 1]);
  });

  it('uses quorum 1 so a single endpoint can answer', () => {
    const provider = toEthersProvider([
      endpoint('https://a.example'),
      endpoint('https://b.example'),
    ]);
    expect(provider.quorum).toBe(1);
  });

  it('throws EmptyEndpointSetError on an empty list', () => {
    expect(() => toEthersProvider([])).toThrow(EmptyEndpointSetError);
  });
});
