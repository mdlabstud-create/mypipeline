import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/publisher/publisher.types', () => {
  return {
    getFullListingById: vi.fn(() =>
      Promise.resolve({ id: 'l1', status: 'pending_review' })
    )
  };
});

vi.mock('../../src/modules/publisher/duplicate.check', () => {
  return { checkDuplicate: vi.fn(() => Promise.resolve(false)) };
});

describe('publisher gate', () => {
  it('publishToShopify throws when demo/local credentials are used', async () => {
    process.env.DEMO_MODE = 'true';
    vi.resetModules();
    const { publishToShopify } = await import('../../src/modules/publisher/shopify.service');
    await expect(publishToShopify('l1')).rejects.toThrow(/publishing disabled/i);
  });

  it('publishToShopify throws when listing not approved (gate #1)', async () => {
    process.env.DEMO_MODE = 'false';
    process.env.SHOPIFY_ADMIN_TOKEN = 'real-token';
    process.env.SHOPIFY_STORE_URL = 'store.myshopify.com';
    vi.resetModules();
    const { publishToShopify } = await import('../../src/modules/publisher/shopify.service');
    await expect(publishToShopify('l1')).rejects.toThrow(/not approved/i);
  });
});

