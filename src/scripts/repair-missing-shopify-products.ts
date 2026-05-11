import 'dotenv/config';

import axios, { isAxiosError } from 'axios';
import { query } from '../config/db';
import { env } from '../config/env';
import logger from '../shared/logger';
import { publishToShopify } from '../modules/publisher/shopify.service';
import { getShopifyAccessToken } from '../modules/publisher/shopify.token';

function getArg(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function toInt(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function shopifyAdminGraphqlUrl(): string {
  const host = env.SHOPIFY_STORE_URL.replace(/^https?:\/\//i, '').split('/')[0];
  return `https://${host}/admin/api/2025-01/graphql.json`;
}

async function shopifyProductNodeExists(params: {
  productGid: string;
  url: string;
  headers: Record<string, string>;
}): Promise<boolean> {
  const q = `
    query ($id: ID!) {
      node(id: $id) {
        __typename
        ... on Product {
          id
        }
      }
    }
  `;
  try {
    const r = await axios.post<{ data?: { node?: { __typename?: string } | null } }>(
      params.url,
      { query: q, variables: { id: params.productGid } },
      { headers: params.headers }
    );
    return r.data?.data?.node?.__typename === 'Product';
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const dryRun =
    process.argv.includes('--dryRun') || (getArg('dryRun') ?? '').toLowerCase() === 'true';
  const limit = toInt(getArg('limit'), 500);

  const accessToken = (await getShopifyAccessToken()).trim();
  if (!accessToken) throw new Error('Missing Shopify access token');

  const url = shopifyAdminGraphqlUrl();
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken
  };

  const rows = await query<{ id: string; shopify_id: string; title: string }>(
    `SELECT id, shopify_id, title
     FROM product_listings
     WHERE status = 'published'
       AND shopify_id IS NOT NULL
     ORDER BY published_at DESC
     LIMIT $1`,
    [limit]
  );

  logger.info('repair-missing-shopify-products starting', {
    count: rows.length,
    dryRun
  });

  let missing = 0;
  let republished = 0;
  let failed = 0;

  for (const r of rows) {
    const exists = await shopifyProductNodeExists({
      productGid: r.shopify_id,
      url,
      headers
    });
    if (exists) {
      continue;
    }

    missing += 1;
    logger.warn('listing references Shopify product that no longer exists', {
      listingId: r.id,
      title: r.title,
      shopify_id: r.shopify_id
    });

    if (dryRun) {
      continue;
    }

    await query(
      `UPDATE product_listings
       SET status = 'approved',
           shopify_id = NULL,
           shopify_handle = NULL,
           published_at = NULL,
           updated_at = now()
       WHERE id = $1`,
      [r.id]
    );

    try {
      await publishToShopify(r.id);
      republished += 1;
      logger.info('republished listing to Shopify', { listingId: r.id });
    } catch (e: unknown) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('republish failed', { listingId: r.id, message: msg });
    }

    await sleep(400);
  }

  logger.info('repair-missing-shopify-products complete', {
    scanned: rows.length,
    missingShopifyProduct: missing,
    republished,
    failed,
    dryRun
  });
}

void main().catch((e: unknown) => {
  if (isAxiosError(e)) {
    console.error(e.response?.data ?? e.message);
  } else {
    console.error(e);
  }
  process.exit(1);
});
