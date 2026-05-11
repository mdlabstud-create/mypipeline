import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { researchProduct } from '../../src/modules/researcher/researcher.service';
import { createTestPool, runAllMigrations, truncateAll } from './db.helper';

const pool = createTestPool(env.DATABASE_URL);
const itIntegration = process.env.RUN_INTEGRATION === '1' ? it : it.skip;

function hasPhase2Creds(): boolean {
  const hasProxy = Boolean(
    env.WEBSHARE_PROXY_SERVER && env.WEBSHARE_PROXY_USERNAME && env.WEBSHARE_PROXY_PASSWORD
  );
  return Boolean(hasProxy && env.EXCHANGE_RATE_API_KEY);
}

describe('researcher integration', () => {
  beforeAll(async () => {
    await runAllMigrations(pool);
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  itIntegration('researchProduct() persists suppliers and updates product status', async () => {
    if (!hasPhase2Creds()) return;

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO trending_products (keyword, source, trend_score, status)
       VALUES ('wireless earbuds', 'tiktok', 0.9, 'pending_research')
       RETURNING id`
    );
    const productId = inserted.rows[0]?.id;
    expect(productId).toBeTruthy();

    await researchProduct(productId as string);

    const prod = await pool.query<{ status: string }>(
      'SELECT status FROM trending_products WHERE id = $1',
      [productId]
    );
    expect(prod.rows[0]?.status).toBe('pending_content');

    const suppliers = await pool.query('SELECT * FROM suppliers WHERE product_id = $1', [
      productId
    ]);
    expect(suppliers.rows.length).toBeGreaterThanOrEqual(1);
  }, 180_000);
});

