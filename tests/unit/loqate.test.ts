import { describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import axios from 'axios';

vi.mock('axios', () => {
  return {
    default: {
      get: vi.fn(() =>
        Promise.resolve({ data: { Items: [{ Type: 'NotAddress' }] } })
      ),
      post: vi.fn(() => Promise.resolve({ data: {} }))
    }
  };
});

vi.mock('../../src/shared/logger', () => {
  return {
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logPipelineEvent: vi.fn(() => Promise.resolve())
  };
});

describe('loqate webhook', () => {
  it('tags order when loqate unverified', async () => {
    vi.resetModules();

    process.env.LOQATE_API_KEY = 'x';
    process.env.SHOPIFY_STORE_URL = 'example.myshopify.com';
    process.env.SHOPIFY_ADMIN_TOKEN = 'tok';
    process.env.SHOPIFY_WEBHOOK_SECRET = 'whsec';

    const { createApp } = await import('../../src/api/server');
    const request = (await import('supertest')).default;

    const body = { id: 123, shipping_address: { address1: '1 main', city: 'x' } };
    const raw = JSON.stringify(body);
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET ?? '';
    const hmac = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('base64');

    const app = createApp();
    const res = await request(app)
      .post('/webhooks/shopify/orders/created')
      .set('x-shopify-hmac-sha256', hmac)
      .send(body);

    expect(res.status).toBe(200);

    expect((axios.post as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});

