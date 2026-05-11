import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/db', () => {
  return { query: vi.fn(() => Promise.resolve([{ key: 'markupMultiplier', value: '2.8' }])) };
});

describe('GET /api/settings', () => {
  it('returns settings object', async () => {
    const { createApp } = await import('../../src/api/server');
    const app = createApp();
    const res = await request(app).get('/api/settings').expect(200);
    expect(res.body.markupMultiplier).toBeTruthy();
  });
});

