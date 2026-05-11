import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/db', () => {
  return { query: vi.fn(() => Promise.resolve([])) };
});

describe('products list/edit routes', () => {
  it('GET /api/products returns an array', async () => {
    const { query } = await import('../../src/config/db');
    (query as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() =>
        Promise.resolve([
          {
            id: 'l1',
            product_id: 'p1',
            supplier_id: 'sTop',
            title: 't',
            description: 'd',
            tags: [],
            images: [],
            cost_usd: 10,
            retail_usd: 27.99,
            margin_pct: 64,
            status: 'pending_review',
            source: 'tiktok',
            trend_score: 0.9
          }
        ])
      )
      .mockImplementationOnce(() =>
        Promise.resolve([
          {
            id: 's1',
            product_id: 'p1',
            platform: 'aliexpress',
            supplier_url: 'u',
            price_usd: 10,
            moq: 1,
            rating: null,
            shipping_days: 7,
            supplier_score: 0.9,
            rank: 1
          }
        ])
      );

    const { createApp } = await import('../../src/api/server');
    const app = createApp();

    const res = await request(app).get('/api/products?status=pending_review&limit=20&offset=0');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(Array.isArray(res.body.items[0].suppliers)).toBe(true);
    expect(res.body.items[0].productId).toBeTruthy();
  });

  it('PUT /api/products/:id updates allowed fields', async () => {
    const { query } = await import('../../src/config/db');
    (query as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => Promise.resolve([{ cost_usd: 10 }])) // select existing
      .mockImplementationOnce(() => Promise.resolve([])) // update
      .mockImplementationOnce(() => Promise.resolve([{ id: 'l1', title: 'new' }])); // return updated

    const { createApp } = await import('../../src/api/server');
    const app = createApp();

    const res = await request(app)
      .put('/api/products/l1')
      .send({ title: 'new', retailUsd: 27.99 })
      .expect(200);

    expect(res.body).toBeTruthy();
  });
});

