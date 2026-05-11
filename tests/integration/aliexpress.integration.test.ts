import { describe, expect, it } from 'vitest';
import { searchAliExpress } from '../../src/modules/researcher/aliexpress';
import { env } from '../../src/config/env';

const itIntegration = process.env.RUN_INTEGRATION === '1' ? it : it.skip;

function hasCreds(): boolean {
  return Boolean(env.ALIEXPRESS_APP_KEY && env.ALIEXPRESS_APP_SECRET && env.ALIEXPRESS_TRACKING_ID);
}

describe('aliexpress integration', () => {
  itIntegration('searchAliExpress returns suppliers for known keyword', async () => {
    if (!hasCreds()) return;
    const out = await searchAliExpress('wireless earbuds');
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]?.priceUsd).toBeGreaterThan(0);
  }, 60_000);
});

