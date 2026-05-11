import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { verifyShopifyHmac } from '../../src/api/routes/webhooks.routes';

describe('shopify webhook hmac', () => {
  it('verifies valid hmac', () => {
    const secret = 'secret';
    const rawBody = JSON.stringify({ hello: 'world' });
    const hmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');

    const ok = verifyShopifyHmac({ secret, rawBody, providedHmac: hmac });
    expect(ok).toBe(true);
  });

  it('rejects invalid hmac', () => {
    const ok = verifyShopifyHmac({ secret: 's', rawBody: '{}', providedHmac: 'nope' });
    expect(ok).toBe(false);
  });
});

