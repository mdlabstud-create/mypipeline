import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/db', () => {
  return { query: vi.fn(() => Promise.resolve([])) };
});

describe('GET /api/metrics', () => {
  it('returns all 4 metric fields as numbers', async () => {
    const { query } = await import('../../src/config/db');
    // productsFoundToday, pendingReview, publishedToday, avgMarginPct
    (query as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => Promise.resolve([{ count: '5' }]))
      .mockImplementationOnce(() => Promise.resolve([{ count: '2' }]))
      .mockImplementationOnce(() => Promise.resolve([{ count: '1' }]))
      .mockImplementationOnce(() => Promise.resolve([{ avg: '33.33' }]));

    const { createApp } = await import('../../src/api/server');
    const app = createApp();

    const res = await request(app).get('/api/metrics').expect(200);
    expect(res.body.productsFoundToday).toBeTypeOf('number');
    expect(res.body.pendingReview).toBeTypeOf('number');
    expect(res.body.publishedToday).toBeTypeOf('number');
    expect(res.body.avgMarginPct).toBeTypeOf('number');
  });
});

