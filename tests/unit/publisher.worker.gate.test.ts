import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/publisher/publisher.types', () => {
  return {
    getListingById: vi.fn(() => Promise.resolve({ id: 'l1', status: 'pending_review' }))
  };
});

vi.mock('../../src/modules/publisher/shopify.service', () => {
  return { publishToShopify: vi.fn(() => Promise.resolve()) };
});

describe('publisher worker gate #2', () => {
  it('does not call publishToShopify when listing not approved', async () => {
    const { publisherProcessor } = await import(
      '../../src/queues/workers/publisher.worker'
    );
    const { publishToShopify } = await import('../../src/modules/publisher/shopify.service');

    await publisherProcessor({ listingId: 'l1' });

    expect(publishToShopify).not.toHaveBeenCalled();
  });
});

