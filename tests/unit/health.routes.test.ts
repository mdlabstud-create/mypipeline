import { describe, expect, it } from 'vitest';
import request from 'supertest';

describe('health routes', () => {
  it('GET /health returns liveness payload', async () => {
    const { createApp } = await import('../../src/api/server');
    const app = createApp();

    const res = await request(app).get('/health').expect(200);
    expect(res.body).toMatchObject({ ok: true, service: 'dropship-pipeline' });
  });
});
