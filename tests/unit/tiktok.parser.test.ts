import { describe, expect, it } from 'vitest';
import {
  calculateTikTokScore,
  extractTikTokRetailUsd,
  normalizeTikTokKeyword,
  parseTikTokItems
} from '../../src/modules/scraper-tiktok/tiktok.parser';

describe('tiktok.parser', () => {
  it('normalizeTikTokKeyword normalizes a caption into a keyword phrase', () => {
    const out = normalizeTikTokKeyword('#viral This LED strip light is amazing');
    expect(out).toContain('led');
    expect(out).toContain('strip');
    expect(out).toContain('light');
  });

  it('calculateTikTokScore(1_000_000) returns value between 0.8 and 0.9', () => {
    const score = calculateTikTokScore(1_000_000);
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThan(0.9);
  });

  it('calculateTikTokScore(0) returns 0', () => {
    expect(calculateTikTokScore(0)).toBe(0);
  });

  it('parseTikTokItems accepts clockworks shape (text + top-level playCount)', () => {
    const out = parseTikTokItems([
      {
        id: '7204347705928191259',
        text: 'LED strip haul #fyp #shopping',
        playCount: 12600,
        diggCount: 517,
        webVideoUrl: 'https://www.tiktok.com/@u/video/7204347705928191259',
        authorMeta: { name: 'creator1' }
      }
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: '7204347705928191259',
      desc: 'LED strip haul #fyp #shopping',
      playCount: 12600,
      diggCount: 517,
      author: 'creator1',
      url: 'https://www.tiktok.com/@u/video/7204347705928191259'
    });
  });

  it('parseTikTokItems accepts legacy desc + stats.playCount', () => {
    const out = parseTikTokItems([
      {
        id: 'abc',
        desc: 'caption here',
        stats: { playCount: 99_000, diggCount: 10 }
      }
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.playCount).toBe(99_000);
    expect(out[0]?.diggCount).toBe(10);
  });

  it('parseTikTokItems coerces string playCount and numeric id', () => {
    const out = parseTikTokItems([{ id: 123, text: 'x', playCount: '5000' }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('123');
    expect(out[0]?.playCount).toBe(5000);
  });

  it('parseTikTokItems omits optional keys when missing (no `key: undefined`)', () => {
    // Required for `exactOptionalPropertyTypes`: callers checking `'diggCount' in item`
    // must get false when the source had no diggCount.
    const out = parseTikTokItems([{ id: 'x', text: 'caption', playCount: 1000 }]);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toHaveProperty('diggCount');
    expect(out[0]).not.toHaveProperty('shareCount');
    expect(out[0]).not.toHaveProperty('commentCount');
    expect(out[0]).not.toHaveProperty('author');
    expect(out[0]).not.toHaveProperty('url');
    expect(out[0]).not.toHaveProperty('tiktokRetailUsd');
  });

  it('parseTikTokItems picks $ price from caption when no structured price', () => {
    const out = parseTikTokItems([{ id: '1', text: 'Only $24.99 today #fyp', playCount: 50_000 }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.tiktokRetailUsd).toBe(24.99);
  });

  it('parseTikTokItems prefers structured commerce.price over caption', () => {
    const out = parseTikTokItems([
      {
        id: '2',
        text: '$99 gimmick caption',
        playCount: 50_000,
        product: { price: { value: '12.5' } }
      }
    ]);
    expect(out[0]?.tiktokRetailUsd).toBe(12.5);
  });

  it('extractTikTokRetailUsd returns null when no price signals', () => {
    expect(extractTikTokRetailUsd({ id: 'x' }, 'no money here')).toBeNull();
  });
});

