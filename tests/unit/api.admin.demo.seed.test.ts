import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/modules/demo/demo.seed', () => {
  return { seedDemoData: vi.fn(() => Promise.resolve({ listingIds: ['l1'] })) };
});

describe('admin demo seed', () => {
  it('returns 403 when DEMO_MODE is false', async () => {
    process.env.DEMO_MODE = 'false';
    vi.resetModules();
    const { createApp } = await import('../../src/api/server');
    const app = createApp();
    await request(app).post('/api/admin/demo/seed').send({ count: 2 }).expect(403);
  });

  it('seeds when DEMO_MODE is true', async () => {
    process.env.DEMO_MODE = 'true';
    vi.resetModules();

    const { createApp } = await import('../../src/api/server');
    const app = createApp();
    const res = await request(app).post('/api/admin/demo/seed').send({ count: 2 }).expect(200);
    expect(res.body.listingIds).toEqual(['l1']);
  });

  it('accepts an empty body (count is optional, defaults to 3)', async () => {
    process.env.DEMO_MODE = 'true';
    vi.resetModules();

    const { createApp } = await import('../../src/api/server');
    const app = createApp();

    const res = await request(app).post('/api/admin/demo/seed').send({}).expect(200);
    expect(res.body.ok).toBe(true);

    const { seedDemoData } = await import('../../src/modules/demo/demo.seed');
    const calls = (seedDemoData as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const lastArg = calls[calls.length - 1]?.[0];
    // Must NOT pass `{ count: undefined }` — that violates exactOptionalPropertyTypes.
    expect(lastArg).not.toHaveProperty('count');
  });
});

