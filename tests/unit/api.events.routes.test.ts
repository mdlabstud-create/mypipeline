import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/db', () => {
  return {
    query: vi.fn(() => Promise.resolve([{ id: 'e1', stage: 'x', status: 'ok', message: 'm' }]))
  };
});

describe('GET /api/events', () => {
  it('sets SSE headers and can return once=1', async () => {
    const { createApp } = await import('../../src/api/server');
    const app = createApp();

    const res = await request(app).get('/api/events?once=1').expect(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('data:');
  });
});

