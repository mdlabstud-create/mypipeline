import { describe, expect, it } from 'vitest';
import { roundTo99, computeDynamicPrice } from '../../src/modules/pricing-engine/pricing.engine';

describe('pricing engine', () => {
  it('roundTo99 rounds 32.18 -> 31.99', () => {
    expect(roundTo99(32.18)).toBe(31.99);
  });

  it('computes final price within competitor ceiling', () => {
    const out = computeDynamicPrice({
      costUsd: 10,
      competitorPrice: 35,
      targetMarginPct: 40,
      minMarkup: 1.5,
      maxCompetitorRatio: 0.95,
      holidayMode: false,
      holidayMarkupMultiplier: 1.15,
      minMarginPct: 10
    });
    // competitor ceiling = 33.25 -> rounded to 32.99 or 33.99 depending rounding logic
    expect(out.retailUsd).toBeLessThanOrEqual(33.25);
    expect(out.marginPct).toBeGreaterThanOrEqual(10);
  });
});

