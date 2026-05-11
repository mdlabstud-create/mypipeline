import { describe, expect, it } from 'vitest';
import {
  calculateAmazonScore,
  normalizeAmazonKeyword,
  parseAmazonItems
} from '../../src/modules/scraper-amazon/amazon.parser';

describe('amazon.parser', () => {
  it('parses price from string payloads', () => {
    const out = parseAmazonItems({
      results: [
        { asin: 'B012345678', title: 'Test Product Thing Here', organic_position: 1, price: '$29.99' }
      ]
    });
    expect(out[0]?.price).toBeCloseTo(29.99);
  });

  it('normalizeAmazonKeyword removes brand and normalizes phrase', () => {
    const out = normalizeAmazonKeyword('Anker 30W USB-C Charger Fast Charging Block');
    expect(out.toLowerCase()).not.toContain('anker');
    const parts = out.trim().split(/\s+/);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.length).toBeLessThanOrEqual(6);
  });

  it('calculateAmazonScore(1, 5000) returns close to 1.0', () => {
    const score = calculateAmazonScore(1, 5000);
    expect(score).toBeGreaterThan(0.99);
  });

  it('calculateAmazonScore(5000, 5000) returns 0', () => {
    expect(calculateAmazonScore(5000, 5000)).toBe(0);
  });
});

