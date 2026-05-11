import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db', () => {
  return {
    query: vi.fn()
  };
});

describe('applyDynamicPricing', () => {
  it('updates listing with computed retail', async () => {
    const { query } = await import('../../src/config/db');
    (query as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ cost_usd: 10 }])
      .mockResolvedValueOnce([]);

    const { applyDynamicPricing } = await import('../../src/modules/pricing-engine/pricing.engine');
    await applyDynamicPricing('abc', {
      targetMarginPct: 40,
      minMarkup: 1.8,
      maxCompetitorRatio: 0.95,
      holidayMode: false,
      holidayMarkupMultiplier: 1.15,
      minMarginPct: 25
    });

    expect(query).toHaveBeenCalledTimes(2);
  });
});

