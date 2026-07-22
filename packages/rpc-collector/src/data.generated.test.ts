import { describe, expect, it } from 'vitest';

import {
  CHAIN_ID_BY_NAME,
  CHAIN_NAME_BY_ID,
  RPCS_BY_CHAIN_ID,
} from './data.generated.js';

describe('generated chainlist data', () => {
  it('includes ethereum mainnet with endpoints', () => {
    expect(RPCS_BY_CHAIN_ID['1']?.length).toBeGreaterThan(5);
  });

  it('maps mainnet id to name and back', () => {
    expect(CHAIN_NAME_BY_ID['1']).toBe('ethereum');
    expect(CHAIN_ID_BY_NAME['ethereum']).toBe('1');
  });

  it('normalizes every record to a url and a tracking value', () => {
    for (const records of Object.values(RPCS_BY_CHAIN_ID)) {
      for (const record of records) {
        expect(typeof record.url).toBe('string');
        expect(record.url.length).toBeGreaterThan(0);
        expect(typeof record.tracking).toBe('string');
        expect(record.tracking.length).toBeGreaterThan(0);
      }
    }
  });

  it('drops trackingDetails prose from the shipped data', () => {
    const mainnet = RPCS_BY_CHAIN_ID['1'] ?? [];
    for (const record of mainnet) {
      expect(record).not.toHaveProperty('trackingDetails');
    }
  });
});
