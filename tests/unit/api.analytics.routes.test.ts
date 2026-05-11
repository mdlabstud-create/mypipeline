import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/db', () => {
  return { query: vi.fn(() => Promise.resolve([])) };
});

describe('GET /api/analytics', () => {
  it('returns expected shape', async () => {
    const { query } = await import('../../src/config/db');
    (query as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => Promise.resolve([{ date: '2026-04-01', count: '2' }]))
      .mockImplementationOnce(() => Promise.resolve([{ approval_rate: '50' }]))
      .mockImplementationOnce(() => Promise.resolve([{ tag: 'tag1', avg_margin: '33.3' }]))
      .mockImplementationOnce(() => Promise.resolve([{ source: 'tiktok', pct: '60' }]));

    const { createApp } = await import('../../src/api/server');
    const app = createApp();

    const res = await request(app).get('/api/analytics').expect(200);
    expect(res.body.dailyProducts).toBeTruthy();
    expect(res.body.approvalRate).toBeTypeOf('number');
    expect(res.body.avgMarginByCategory).toBeTruthy();
    expect(res.body.sourceBreakdown).toBeTruthy();
  });
});

