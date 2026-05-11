import { describe, expect, it } from 'vitest';
import { roundDownToCharm99 } from '../../src/shared/charm-price';

describe('roundDownToCharm99', () => {
  it('pulls weakly-priced SKUs only one notch (33.70 -> 32.99, never old 31.99)', () => {
    expect(roundDownToCharm99(33.7)).toBe(32.99);
    expect(roundDownToCharm99(33.99)).toBe(33.99);
    expect(roundDownToCharm99(34.05)).toBe(33.99);
  });

  it('handles values just below prior dollar (.70 -> .99)', () => {
    expect(roundDownToCharm99(28)).toBe(27.99);
    expect(roundDownToCharm99(32.18)).toBe(31.99);
  });
});
