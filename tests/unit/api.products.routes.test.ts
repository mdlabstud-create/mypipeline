import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../src/config/db', () => {
  return { query: vi.fn(() => Promise.resolve([])) };
});

vi.mock('../../src/queues/pipeline.queue', () => {
  return {
    publishProductQueue: {
      add: vi.fn(() => Promise.resolve({ id: 'job1' }))
    }
  };
});

describe('products routes', () => {
  it('POST /api/products/:id/reject without reason returns 400', async () => {
    const { createApp } = await import('../../src/api/server');
    const app = createApp();
    const res = await request(app)
      .post('/api/products/l1/reject')
      .send({ reviewedBy: 'admin', reason: '' });
    expect(res.status).toBe(400);
  });

  it('POST /api/products/:id/approve updates DB and enqueues publish job', async () => {
    const { query } = await import('../../src/config/db');
    (query as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve([]));

    const { publishProductQueue } = await import('../../src/queues/pipeline.queue');
    const { createApp } = await import('../../src/api/server');
    const app = createApp();

    const res = await request(app)
      .post('/api/products/l1/approve')
      .send({ reviewedBy: 'admin' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(publishProductQueue.add).toHaveBeenCalledWith(
      'publish-product',
      expect.objectContaining({ listingId: 'l1' })
    );
  });

  it('POST /api/products/:id/approve can pass shopifyStatus DRAFT to publish job', async () => {
    const { query } = await import('../../src/config/db');
    (query as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve([]));

    const { publishProductQueue } = await import('../../src/queues/pipeline.queue');
    const { createApp } = await import('../../src/api/server');
    const app = createApp();

    await request(app)
      .post('/api/products/l1/approve')
      .send({ reviewedBy: 'admin', shopifyStatus: 'DRAFT' })
      .expect(200);

    expect(publishProductQueue.add).toHaveBeenCalledWith('publish-product', {
      listingId: 'l1',
      shopifyStatus: 'DRAFT'
    });
  });
});
