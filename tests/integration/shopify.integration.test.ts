import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { createTestPool, runAllMigrations, truncateAll } from './db.helper';

const itIntegration = process.env.RUN_INTEGRATION === '1' ? it : it.skip;
const pool = createTestPool(env.DATABASE_URL);

function hasCreds(): boolean {
  return Boolean(env.SHOPIFY_STORE_URL && env.SHOPIFY_ADMIN_TOKEN);
}

describe('shopify integration', () => {
  beforeAll(async () => {
    await runAllMigrations(pool);
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  itIntegration('publishToShopify creates draft for approved listing', async () => {
    if (!hasCreds()) return;

    const product = await pool.query<{ id: string }>(
      `INSERT INTO trending_products (keyword, source, trend_score, status)
       VALUES ('test product', 'tiktok', 0.9, 'pending_review')
       RETURNING id`
    );
    const productId = product.rows[0]?.id;
    expect(productId).toBeTruthy();

    const supplier = await pool.query<{ id: string }>(
      `INSERT INTO suppliers (product_id, platform, supplier_url, price_usd, moq, images, rank)
       VALUES ($1, 'aliexpress', 'https://example.com', 10, 1, '[]', 1)
       RETURNING id`,
      [productId]
    );
    const supplierId = supplier.rows[0]?.id;

    const listing = await pool.query<{ id: string }>(
      `INSERT INTO product_listings
        (product_id, supplier_id, title, description, bullet_points, tags, images,
         cost_usd, retail_usd, margin_pct, status)
       VALUES ($1,$2,'Test Listing','Desc','[]',ARRAY['tag1','tag2'],'[]',10,27.99,64.0,'approved')
       RETURNING id`,
      [productId, supplierId]
    );
    const listingId = listing.rows[0]?.id;
    expect(listingId).toBeTruthy();

    const { publishToShopify } = await import('../../src/modules/publisher/shopify.service');
    await publishToShopify(listingId as string);

    const updated = await pool.query<{ shopify_id: string | null; status: string }>(
      'SELECT shopify_id, status FROM product_listings WHERE id = $1',
      [listingId]
    );
    expect(updated.rows[0]?.status).toBe('published');
    expect(updated.rows[0]?.shopify_id).toBeTruthy();
  }, 180_000);
});

