import { describe, expect, it } from 'vitest';
import type { SupplierCandidate } from '../../src/shared/types';
import { rankSuppliers } from '../../src/modules/researcher/ranker';

function s(
  partial: Partial<SupplierCandidate> & { priceUsd: number; moq: number }
): SupplierCandidate {
  return {
    platform: partial.platform ?? 'aliexpress',
    supplierUrl: partial.supplierUrl ?? 'https://example.com',
    priceUsd: partial.priceUsd,
    moq: partial.moq,
    images: partial.images ?? [],
    rating: partial.rating ?? null,
    reviewCount: partial.reviewCount ?? 0,
    shippingDays: partial.shippingDays ?? 21,
    fastShip: partial.fastShip ?? false,
    priceCny: null,
    productTitle: null
  };
}

describe('rankSuppliers', () => {
  it('returns suppliers ranked best-to-worst and assigns rank 1..', () => {
    const suppliers: SupplierCandidate[] = [
      s({ priceUsd: 10, rating: 4.5, shippingDays: 7, moq: 1 }),
      s({ priceUsd: 8, rating: 4.2, shippingDays: 14, moq: 2 }),
      s({ priceUsd: 15, rating: 4.9, shippingDays: 21, moq: 100 }),
      s({ priceUsd: 9, rating: 3.5, shippingDays: 30, moq: 1 }),
      s({ priceUsd: 7, rating: 4.1, shippingDays: 25, moq: 10 })
    ];

    const ranked = rankSuppliers(suppliers);
    expect(ranked.length).toBeLessThanOrEqual(5);
    expect(ranked[0]?.rank).toBe(1);
    expect(ranked[1]?.rank).toBe(2);

    const scores = ranked.map((r) => r.supplierScore ?? 0);
    for (let i = 1; i < scores.length; i += 1) {
      const prev = scores[i - 1] ?? 0;
      const curr = scores[i] ?? 0;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

