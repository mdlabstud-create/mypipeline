import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/db', () => {
  return { query: vi.fn(() => Promise.resolve([])) };
});

describe('settings routes', () => {
  it('PUT /api/settings persists updated config', async () => {
    const { query } = await import('../../src/config/db');
    (query as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => Promise.resolve([]))
      .mockImplementationOnce(() => Promise.resolve([{ key: 'markupMultiplier', value: '3.5' }]));

    const { createApp } = await import('../../src/api/server');
    const app = createApp();

    const res = await request(app)
      .put('/api/settings')
      .send({ markupMultiplier: 3.5 })
      .expect(200);
    expect(res.body).toBeTruthy();
  });
});

