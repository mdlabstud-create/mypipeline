import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { runMerger } from '../../src/modules/merger/merger.service';
import { createTestPool, runAllMigrations, truncateAll } from './db.helper';

const pool = createTestPool(env.DATABASE_URL);
const itIntegration = process.env.RUN_INTEGRATION === '1' ? it : it.skip;

describe('merger integration', () => {
  beforeAll(async () => {
    await runAllMigrations(pool);
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  itIntegration("sets status='pending_research' for rows with score >= 0.40 and 'rejected' otherwise", async () => {
    await pool.query(
      `INSERT INTO trending_products (keyword, source, tiktok_score, amazon_score, trend_score, status)
       VALUES
        ('led strip light', 'tiktok', 0.8, NULL, 0.8, 'pending_research'),
        ('led strip light', 'amazon', NULL, 0.7, 0.7, 'pending_research'),
        ('low score item', 'tiktok', 0.1, NULL, 0.1, 'pending_research')`
    );

    const productIds = await runMerger();
    expect(Array.isArray(productIds)).toBe(true);

    const rows = await pool.query<{ keyword: string; status: string; source: string }>(
      'SELECT keyword, status, source FROM trending_products ORDER BY keyword'
    );

    const merged = rows.rows.find((r) => r.keyword === 'led strip light');
    expect(merged).toBeTruthy();
    expect(merged?.status).toBe('pending_research');
    expect(merged?.source).toBe('both');

    const rejected = rows.rows.find((r) => r.keyword === 'low score item');
    expect(rejected).toBeTruthy();
    expect(rejected?.status).toBe('rejected');
  });
});

