import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { createTestPool, runAllMigrations, truncateAll } from '../integration/db.helper';

const pool = createTestPool(env.DATABASE_URL);
const itE2E = process.env.RUN_INTEGRATION === '1' ? it : it.skip;

describe('phase2 e2e', () => {
  beforeAll(async () => {
    await runAllMigrations(pool);
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  itE2E('Phase 1 merge -> Phase 2 research persists suppliers', async () => {
    const { runMerger } = await import('../../src/modules/merger/merger.service');
    const { researchProduct } = await import(
      '../../src/modules/researcher/researcher.service'
    );

    // Seed rows as if Phase 1 scrapers inserted them.
    await pool.query(
      `INSERT INTO trending_products (keyword, source, tiktok_score, amazon_score, trend_score, status)
       VALUES
        ('wireless earbuds', 'tiktok', 0.8, NULL, 0.8, 'pending_research'),
        ('wireless earbuds', 'amazon', NULL, 0.7, 0.7, 'pending_research')`
    );

    const ids = await runMerger();
    expect(ids.length).toBeGreaterThanOrEqual(1);

    await researchProduct(ids[0] as string);

    const prod = await pool.query<{ status: string }>(
      'SELECT status FROM trending_products WHERE id = $1',
      [ids[0]]
    );
    expect(prod.rows[0]?.status).toBe('pending_content');

    const suppliers = await pool.query('SELECT * FROM suppliers WHERE product_id = $1', [
      ids[0]
    ]);
    expect(suppliers.rows.length).toBeGreaterThanOrEqual(1);
  }, 240_000);
});

