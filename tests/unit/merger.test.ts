import { describe, expect, it } from 'vitest';
import { mergeAndScore } from '../../src/modules/merger/merger.logic';

describe('merger', () => {
  it("merges tiktok+amazon entries into source='both' with bonus applied", () => {
    const out = mergeAndScore({
      keyword: 'led strip light',
      tiktokScore: 0.8,
      amazonScore: 0.7,
      threshold: 0.4
    });
    expect(out.source).toBe('both');
    expect(out.trendScore).toBeGreaterThan(0.6);
  });

  it("sets status='rejected' when below threshold", () => {
    const out = mergeAndScore({
      keyword: 'x',
      tiktokScore: 0.1,
      amazonScore: 0.1,
      threshold: 0.4
    });
    expect(out.status).toBe('rejected');
  });

  it("sets status='pending_research' when above threshold", () => {
    const out = mergeAndScore({
      keyword: 'y',
      tiktokScore: 0.9,
      amazonScore: 0.9,
      threshold: 0.4
    });
    expect(out.status).toBe('pending_research');
  });

  it('uses Amazon-only scores when TikTok is missing', () => {
    const out = mergeAndScore({
      keyword: 'z',
      tiktokScore: null,
      amazonScore: 0.7,
      threshold: 0.4
    });
    expect(out.source).toBe('amazon');
    expect(out.trendScore).toBeGreaterThanOrEqual(0.7);
    expect(out.status).toBe('pending_research');
  });
});

