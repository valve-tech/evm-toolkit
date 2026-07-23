import { describe, expect, it } from 'vitest';

import { collectRpcs } from './collect.js';
import { UnknownChainError, type Tracking } from './types.js';

const TRACKING_ORDER: Tracking[] = [
  'none',
  'limited',
  'unspecified',
  'unknown',
  'yes',
];

describe('collectRpcs', () => {
  it('returns http endpoints for mainnet by chainId', () => {
    const endpoints = collectRpcs({ chainId: 1 });
    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.protocol === 'http')).toBe(true);
    expect(endpoints.every((e) => e.chainId === 1)).toBe(true);
  });

  it('accepts a string chainId', () => {
    expect(collectRpcs({ chainId: '1' })).toEqual(collectRpcs({ chainId: 1 }));
  });

  it('resolves a chain by name, case-insensitively', () => {
    expect(collectRpcs({ chainName: 'Ethereum' })).toEqual(
      collectRpcs({ chainId: 1 }),
    );
  });

  it('orders endpoints privacy-first', () => {
    const endpoints = collectRpcs({ chainId: 1, protocol: 'any' });
    const ranks = endpoints.map((e) => TRACKING_ORDER.indexOf(e.tracking));
    const sorted = [...ranks].sort((a, b) => a - b);
    expect(ranks).toEqual(sorted);
  });

  it('does not silently drop tracked endpoints by default', () => {
    const all = collectRpcs({ chainId: 1, protocol: 'any' });
    expect(all.some((e) => e.tracking === 'yes')).toBe(true);
  });

  it('filters by allowedTracking when asked', () => {
    const endpoints = collectRpcs({
      chainId: 1,
      allowedTracking: ['none'],
    });
    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.tracking === 'none')).toBe(true);
  });

  it('strips endpoints with unresolved template placeholders', () => {
    for (const chainId of [1, 56, 8453]) {
      const endpoints = collectRpcs({ chainId, protocol: 'any' });
      expect(endpoints.every((e) => !e.url.includes('${'))).toBe(true);
    }
  });

  it('returns only websocket endpoints when asked', () => {
    const endpoints = collectRpcs({ chainId: 1, protocol: 'ws' });
    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints.every((e) => e.protocol === 'ws')).toBe(true);
  });

  it('applies limit after ordering', () => {
    const all = collectRpcs({ chainId: 1 });
    const limited = collectRpcs({ chainId: 1, limit: 3 });
    expect(limited).toEqual(all.slice(0, 3));
  });

  it('deduplicates repeated urls', () => {
    const urls = collectRpcs({ chainId: 1, protocol: 'any' }).map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('throws UnknownChainError for an id that is not in the dataset', () => {
    expect(() => collectRpcs({ chainId: 99999999999 })).toThrow(
      UnknownChainError,
    );
  });

  it('throws UnknownChainError for an unknown chain name', () => {
    expect(() => collectRpcs({ chainName: 'not-a-real-chain' })).toThrow(
      UnknownChainError,
    );
  });

  it('throws a TypeError when neither chainId nor chainName is given', () => {
    expect(() => collectRpcs({})).toThrow(TypeError);
  });

  it('returns an empty array when filters exclude everything', () => {
    const endpoints = collectRpcs({
      chainId: 1,
      allowedTracking: [],
    });
    expect(endpoints).toEqual([]);
  });
});
