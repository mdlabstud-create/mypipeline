import { describe, expect, it } from 'vitest';
import { convertCnyToUsd } from '../../src/modules/researcher/src1688';

describe('1688 conversion', () => {
  it('converts CNY price to USD and rounds to 2 decimals', () => {
    const usd = convertCnyToUsd(35, 0.138);
    expect(usd).toBe(4.83);
  });
});

