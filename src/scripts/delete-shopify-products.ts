import 'dotenv/config';
import axios, { isAxiosError } from 'axios';
import { env } from '../config/env';
import { query } from '../config/db';
import { getShopifyAccessToken } from '../modules/publisher/shopify.token';
import logger from '../shared/logger';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseProductDelete(data: unknown): {
  deletedProductId: string | null;
  userErrors: unknown[];
} | null {
  if (!isObject(data)) return null;
  const d = data['data'];
  if (!isObject(d)) return null;
  const pd = d['productDelete'];
  if (!isObject(pd)) return null;
  const del = pd['deletedProductId'];
  const errs = pd['userErrors'];
  return {
    deletedProductId: typeof del === 'string' ? del : null,
    userErrors: Array.isArray(errs) ? errs : []
  };
}
/**
 * Deletes a list of Shopify products by their numeric IDs and marks the
 * corresponding product_listings rows as 'rejected'. IDs are passed via
 * --ids comma-separated (numeric IDs only, no gid:// prefix).
 */
function getArg(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  const idsCsv = getArg('ids') ?? '';
  const ids = idsCsv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
  if (ids.length === 0) {
    logger.error('no --ids provided');
    process.exit(1);
  }

  const token = (await getShopifyAccessToken()).trim();
  if (!token) throw new Error('Missing Shopify access token');

  const url = `https://${env.SHOPIFY_STORE_URL}/admin/api/2024-10/graphql.json`;
  const headers = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token };

  const mutation = `
    mutation productDelete($input: ProductDeleteInput!) {
      productDelete(input: $input) { deletedProductId userErrors { field message } }
    }
  `;

  let deleted = 0;
  for (const id of ids) {
    const gid = `gid://shopify/Product/${id}`;
    const res = await axios.post(
      url,
      { query: mutation, variables: { input: { id: gid } } },
      { headers, validateStatus: () => true }
    );
    const parsed = parseProductDelete(res.data);
    if (!parsed) {
      logger.warn('shopify productDelete: unexpected response', { id, status: res.status });
      continue;
    }
    const errs = parsed.userErrors;
    if (errs.length > 0) {
      logger.warn('shopify productDelete errors', { id, errors: errs });
      continue;
    }
    if (parsed.deletedProductId) {
      deleted += 1;
      logger.info('shopify product deleted', { id, deletedProductId: parsed.deletedProductId });
      await query(
        `UPDATE product_listings
         SET status='rejected', shopify_id=NULL, reviewed_by='quality-guard', reviewed_at=now()
         WHERE shopify_id = $1`,
        [gid]
      );
    }
  }

  logger.info('delete-shopify-products complete', { requested: ids.length, deleted });
}

void main().catch((e: unknown) => {
  if (isAxiosError(e)) {
    console.error(e.response?.data ?? e.message);
  } else {
    console.error(String(e));
  }
  process.exit(1);
});