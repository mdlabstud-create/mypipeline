import { describe, expect, it } from 'vitest';

describe('shopify orders created webhook GET', () => {
  it('returns 200 for GET (probe / verification)', async () => {
    const { createApp } = await import('../../src/api/server');
    const request = (await import('supertest')).default;
    const app = createApp();
    const res = await request(app).get('/webhooks/shopify/orders/created');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
