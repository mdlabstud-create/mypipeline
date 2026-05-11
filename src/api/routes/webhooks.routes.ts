import crypto from 'node:crypto';
import { Router } from 'express';
import axios from 'axios';
import { env } from '../../config/env';
import logger, { logPipelineEvent } from '../../shared/logger';
import { getShopifyAccessToken } from '../../modules/publisher/shopify.token';
import { parseShopifyOrderWebhook } from '../../modules/order-forwarder/order.parser';

export const webhooksRouter = Router();

webhooksRouter.get('/ping', (_req, res) => {
  res.status(200).json({ ok: true });
});

/** Some clients (browsers, uptime checks) probe the URL with GET — return 200 so verification does not 404. */
webhooksRouter.get('/shopify/orders/created', (_req, res) => {
  res.status(200).json({ ok: true });
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function hmacSha256Base64(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

/**
 * Verifies Shopify HMAC signature.
 */
export function verifyShopifyHmac(params: {
  secret: string;
  rawBody: string;
  providedHmac: string | undefined;
}): boolean {
  if (!params.providedHmac) return false;
  const expected = hmacSha256Base64(params.secret, params.rawBody);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(params.providedHmac));
  } catch {
    return false;
  }
}

async function tagShopifyOrder(orderId: string, tag: string): Promise<void> {
  const url = `https://${env.SHOPIFY_STORE_URL}/admin/api/2025-01/graphql.json`;
  const accessToken = (await getShopifyAccessToken()).trim();
  const mutation = `
    mutation tagsAdd($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        userErrors { field message }
      }
    }
  `;

  const gid = orderId.startsWith('gid://') ? orderId : `gid://shopify/Order/${orderId}`;
  await axios.post(
    url,
    { query: mutation, variables: { id: gid, tags: [tag] } },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      },
      timeout: 20_000
    }
  );
}

webhooksRouter.post('/shopify/orders/created', async (req, res, next) => {
  try {
    const provided = req.header('x-shopify-hmac-sha256') ?? undefined;
    const rawBody =
      Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body ?? {});

    const ok = verifyShopifyHmac({
      secret: env.SHOPIFY_WEBHOOK_SECRET,
      rawBody,
      providedHmac: provided
    });
    if (!ok) {
      res.status(401).json({ error: 'invalid_hmac' });
      return;
    }

    const body: unknown = Buffer.isBuffer(req.body)
      ? (() => {
          try {
            return JSON.parse(req.body.toString('utf8')) as unknown;
          } catch {
            return undefined;
          }
        })()
      : (req.body as unknown);
    if (body === undefined) {
      res.status(400).json({ error: 'invalid_json' });
      return;
    }
    const bodyObj = isObject(body) ? body : {};
    const shipping =
      asRecord(bodyObj['shipping_address']) ?? asRecord(bodyObj['shippingAddress']);

    const addressText = shipping
      ? [
          getString(shipping, 'address1'),
          getString(shipping, 'address2'),
          getString(shipping, 'city'),
          getString(shipping, 'province'),
          getString(shipping, 'zip'),
          getString(shipping, 'country')
        ]
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
          .join(', ')
      : '';

    // Hand off to the order-forwarder queue when auto-forward is enabled.
    // We do this BEFORE the Loqate gate so even unverified addresses get a
    // forwarded_orders row (with manual_review status when the resolver fails).
    if (env.DROPSHIP_AUTO_FORWARD) {
      const incoming = parseShopifyOrderWebhook(body);
      if (incoming) {
        try {
          const { forwardOrderQueue } = await import('../../queues/pipeline.queue');
          await forwardOrderQueue.add(
            'forward-order',
            { order: incoming },
            { jobId: `forward-order-${incoming.shopifyOrderId}` }
          );
          logger.info('order forwarder: enqueued', {
            shopifyOrderId: incoming.shopifyOrderId,
            dryRun: env.DROPSHIP_FORWARD_DRY_RUN
          });
        } catch (e: unknown) {
          // Don't let queue errors break the webhook 200 contract — Shopify
          // will replay anyway and forwarder is idempotent on shopify_order_id.
          logger.error('order forwarder: failed to enqueue', {
            error: e instanceof Error ? e.message : String(e)
          });
        }
      } else {
        logger.warn('order forwarder: skipping — could not parse webhook body');
      }
    }

    if (!env.LOQATE_API_KEY) {
      res.status(200).json({ ok: true });
      return;
    }

    const loq = await axios.get('https://api.addressy.com/Capture/Interactive/Find/v1.10/json3.ws', {
      params: { key: env.LOQATE_API_KEY, text: addressText },
      timeout: 20_000
    });

    const data = loq.data as unknown;
    const dataObj = isObject(data) ? data : {};
    const items = Array.isArray(dataObj['Items']) ? (dataObj['Items'] as unknown[]) : [];
    const first = items[0];
    const verified =
      isObject(first) && typeof first['Type'] === 'string' ? first['Type'] === 'Address' : false;
    if (!verified) {
      const idVal = bodyObj['id'];
      const orderId = typeof idVal === 'number' ? String(idVal) : typeof idVal === 'string' ? idVal : '';
      if (orderId.length > 0) {
        await tagShopifyOrder(orderId, 'address_review_needed');
      }
      await logPipelineEvent({
        stage: 'loqate',
        status: 'warn',
        message: 'address unverified',
        payload: { addressText, orderId }
      });
    }

    // Always return 200 to avoid Shopify retries.
    res.status(200).json({ ok: true });
  } catch (e: unknown) {
    next(e);
  }
});

