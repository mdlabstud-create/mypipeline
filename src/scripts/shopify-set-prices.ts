import 'dotenv/config';

import axios, { isAxiosError } from 'axios';
import { env } from '../config/env';
import { query } from '../config/db';
import logger from '../shared/logger';
import { getShopifyAccessToken } from '../modules/publisher/shopify.token';

type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

function getArg(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function toInt(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}

function money2(n: number): string {
  const v = Math.round(n * 100) / 100;
  return v.toFixed(2);
}

function roundTo99(n: number): number {
  const dollars = Math.floor(n);
  return dollars + 0.99;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Tiered compare-at formula:
 * - < $25  => ~25% off  (compareAt = price / 0.75)
 * - $25-60 => ~30% off  (compareAt = price / 0.70)
 * - > $60  => ~35% off  (compareAt = price / 0.65)
 *
 * Guardrails:
 * - at least +15% (min compareAt = price * 1.15)
 * - at most ~45% off (max compareAt = price / 0.55)
 */
function computeCompareAt(price: number): number {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return 0;

  const targetDivisor = p < 25 ? 0.75 : p <= 60 ? 0.7 : 0.65;
  const raw = p / targetDivisor;

  const min = p * 1.15;
  const max = p / 0.55;
  const clamped = clamp(raw, min, max);

  const rounded = roundTo99(clamped);
  if (rounded <= p) return roundTo99(p * 1.15);
  return rounded;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function shopifyRequest<T>(params: {
  url: string;
  headers: Record<string, string>;
  query: string;
  variables: Record<string, unknown>;
}): Promise<ShopifyGraphqlResponse<T>> {
  try {
    const res = await axios.post<ShopifyGraphqlResponse<T>>(
      params.url,
      { query: params.query, variables: params.variables },
      { headers: params.headers }
    );
    return res.data;
  } catch (err: unknown) {
    if (isAxiosError(err)) {
      const status = err.response?.status;
      const retryHdrUnknown: unknown = err.response?.headers?.['retry-after'];
      const retryAfter = typeof retryHdrUnknown === 'string' ? retryHdrUnknown : undefined;
      if (status === 429) {
        const seconds = retryAfter ? Number(retryAfter) : NaN;
        const waitMs = Number.isFinite(seconds) ? (seconds + 1) * 1000 : 31_000;
        await sleep(waitMs);
        const res = await axios.post<ShopifyGraphqlResponse<T>>(
          params.url,
          { query: params.query, variables: params.variables },
          { headers: params.headers }
        );
        return res.data;
      }
    }
    throw err;
  }
}

type ProductVariantLookupData = {
  product?: {
    variants?: {
      nodes?: Array<{ id: string; price: string | null; compareAtPrice?: string | null }>;
    };
  } | null;
};

function numericProductIdFromShopifyProductGid(gid: string): string | null {
  const m = gid.trim().match(/\/Product\/(\d+)\s*$/);
  return m?.[1] ?? null;
}

function normalizeShopifyStoreHost(raw: string): string {
  let h = raw.trim().replace(/^https?:\/\//i, '');
  const slash = h.indexOf('/');
  if (slash >= 0) h = h.slice(0, slash);
  return h.replace(/\/+$/, '');
}

/**
 * GraphQL sometimes returns zero variants immediately after create or on certain catalogs;
 * REST product fetch is a reliable fallback for the default variant id.
 */
async function restFirstVariantGid(params: {
  storeHost: string;
  accessToken: string;
  productNumericId: string;
}): Promise<string | null> {
  const hostname = normalizeShopifyStoreHost(params.storeHost);
  const res = await axios.get<{ product?: { variants?: Array<{ admin_graphql_api_id?: string; id?: number }> } }>(
    `https://${hostname}/admin/api/2025-01/products/${params.productNumericId}.json`,
    {
      headers: { 'X-Shopify-Access-Token': params.accessToken, 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 30_000
    }
  );
  if (res.status < 200 || res.status >= 300 || !res.data?.product?.variants?.length) {
    return null;
  }
  const v = res.data.product.variants[0];
  if (v?.admin_graphql_api_id) return v.admin_graphql_api_id;
  if (typeof v?.id === 'number') return `gid://shopify/ProductVariant/${v.id}`;
  return null;
}

type VariantsBulkUpdateData = {
  productVariantsBulkUpdate?: {
    userErrors?: Array<{ field?: string[]; message: string }> | null;
  } | null;
};

async function main(): Promise<void> {
  const limit = toInt(getArg('limit'), 1000);
  const dryRun = (getArg('dryRun') ?? 'false').toLowerCase() === 'true';
  const setCompareAt = toBool(getArg('setCompareAt'), true);

  const accessToken = (await getShopifyAccessToken()).trim();
  if (!accessToken) throw new Error('Missing Shopify access token');

  const url = `https://${env.SHOPIFY_STORE_URL}/admin/api/2025-01/graphql.json`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken
  };

  const rows = await query<{
    id: string;
    title: string;
    retail_usd: number;
    shopify_id: string;
  }>(
    `SELECT id, title, retail_usd, shopify_id
     FROM product_listings
     WHERE status='published'
       AND shopify_id IS NOT NULL
     ORDER BY published_at DESC
     LIMIT $1`,
    [limit]
  );

  logger.info('shopify-set-prices starting', { count: rows.length, dryRun });

  const lookupQuery = `
    query productVariant($id: ID!) {
      product(id: $id) {
        variants(first: 25) {
          nodes { id price compareAtPrice }
        }
      }
    }
  `;

  const updateMutation = `
    mutation variantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }
  `;

  let updated = 0;
  for (const r of rows) {
    const shopifyProductId = r.shopify_id;

    const lookup = await shopifyRequest<ProductVariantLookupData>({
      url,
      headers,
      query: lookupQuery,
      variables: { id: shopifyProductId }
    });
    if (lookup.errors?.length) {
      logger.warn('shopify lookup errors', { listingId: r.id, errors: lookup.errors });
      continue;
    }
    let variantId = lookup.data?.product?.variants?.nodes?.[0]?.id ?? null;
    if (!variantId) {
      const nid = numericProductIdFromShopifyProductGid(shopifyProductId);
      if (nid) {
        variantId =
          (await restFirstVariantGid({
            storeHost: env.SHOPIFY_STORE_URL,
            accessToken,
            productNumericId: nid
          })) ?? null;
      }
    }
    if (!variantId) {
      logger.warn('missing variant id', { listingId: r.id, shopifyProductId });
      continue;
    }

    const newPrice = money2(Number(r.retail_usd));
    const compareAt = setCompareAt ? money2(computeCompareAt(Number(r.retail_usd))) : null;
    if (dryRun) {
      logger.info('dry_run_price', {
        listingId: r.id,
        title: r.title,
        shopifyProductId,
        variantId,
        newPrice,
        compareAt
      });
      continue;
    }

    const upd = await shopifyRequest<VariantsBulkUpdateData>({
      url,
      headers,
      query: updateMutation,
      variables: {
        productId: shopifyProductId,
        variants: [
          {
            id: variantId,
            price: newPrice,
            compareAtPrice: compareAt ?? undefined
          }
        ]
      }
    });
    const errs = upd.data?.productVariantsBulkUpdate?.userErrors ?? null;
    if (upd.errors?.length || (errs && errs.length > 0)) {
      logger.warn('shopify price update errors', { listingId: r.id, errors: upd.errors, userErrors: errs });
      continue;
    }

    updated += 1;
    if (updated % 10 === 0) {
      logger.info('shopify-set-prices progress', { updated });
    }

    // Be gentle on rate limits.
    await sleep(200);
  }

  logger.info('shopify-set-prices complete', { updated });
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

