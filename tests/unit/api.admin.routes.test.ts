import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/queues/scheduler', () => {
  return { triggerManually: vi.fn(() => Promise.resolve()) };
});

vi.mock('../../src/config/redis', () => {
  return {
    default: {
      set: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => Promise.resolve(null))
    }
  };
});

vi.mock('../../src/shared/logger', () => {
  return {
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logPipelineEvent: vi.fn(() => Promise.resolve())
  };
});

describe('admin routes', () => {
  it('POST /api/admin/trigger returns ok', async () => {
    const { createApp } = await import('../../src/api/server');
    const app = createApp();
    const res = await request(app).post('/api/admin/trigger').send({}).expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('PUT /api/admin/pipeline/enabled updates redis flag', async () => {
    const redis = (await import('../../src/config/redis')).default as unknown as {
      set: ReturnType<typeof vi.fn>;
    };
    const { createApp } = await import('../../src/api/server');
    const app = createApp();
    const res = await request(app)
      .put('/api/admin/pipeline/enabled')
      .send({ enabled: true })
      .expect(200);
    expect(res.body.enabled).toBe(true);
    expect(redis.set).toHaveBeenCalledWith('pipeline:enabled', '1');
  });
});

