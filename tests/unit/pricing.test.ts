import { describe, expect, it } from 'vitest';
import { calculatePricing } from '../../src/modules/content-generator/pricing';

describe('pricing', () => {
  it('costUsd=10, markup=2.8 -> retailUsd=27.99 and margin ~64%', () => {
    const out = calculatePricing(10, { markupMultiplier: 2.8, minMarginPct: 10 });
    expect(out.retailUsd).toBe(27.99);
    expect(out.marginPct).toBeGreaterThan(60);
    expect(out.marginPct).toBeLessThan(70);
  });

  it('uses Amazon formula (anchor * ratio) when anchor exists', () => {
    const out = calculatePricing(50, {
      markupMultiplier: 2.8,
      minMarginPct: 10,
      amazonRetailAnchorUsd: 100,
      storeVsAmazonRatio: 0.65
    });
    /** 65.00 × ratio → charm step keeps 64.99 (below 65.99 cap). */
    expect(out.retailUsd).toBe(64.99);
    expect(out.marginPct).toBeGreaterThan(20);
  });

  it('spreads anchors that old rounding collapsed into one .99 bucket', () => {
    const hi = calculatePricing(20, {
      markupMultiplier: 2.8,
      minMarginPct: 10,
      amazonRetailAnchorUsd: 37.2,
      storeVsAmazonRatio: 0.92
    });
    const lo = calculatePricing(20, {
      markupMultiplier: 2.8,
      minMarginPct: 10,
      amazonRetailAnchorUsd: 36.5,
      storeVsAmazonRatio: 0.92
    });
    expect(hi.retailUsd).not.toBe(lo.retailUsd);
    expect(hi.retailUsd).toBe(33.99);
    expect(lo.retailUsd).toBe(32.99);
  });

  it('throws when margin too low', () => {
    expect(() =>
      calculatePricing(10, { markupMultiplier: 1.1, minMarginPct: 10 })
    ).toThrow(/Margin too low/);
  });
});

