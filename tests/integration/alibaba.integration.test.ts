import { describe, expect, it } from 'vitest';
import { searchAlibaba } from '../../src/modules/researcher/alibaba';
import { env } from '../../src/config/env';

const itIntegration = process.env.RUN_INTEGRATION === '1' ? it : it.skip;

function hasCreds(): boolean {
  return Boolean(
    env.WEBSHARE_PROXY_SERVER && env.WEBSHARE_PROXY_USERNAME && env.WEBSHARE_PROXY_PASSWORD
  );
}

describe('alibaba integration', () => {
  itIntegration('searchAlibaba returns suppliers without CAPTCHA errors', async () => {
    if (!hasCreds()) return;
    const out = await searchAlibaba('wireless earbuds');
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]?.supplierUrl.length).toBeGreaterThan(0);
  }, 180_000);
});

