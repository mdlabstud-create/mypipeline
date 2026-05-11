import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

export function createTestPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 2 });
}

export async function runAllMigrations(pool: Pool): Promise<void> {
  const dir = path.resolve(process.cwd(), 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
    // Each migration may contain multiple statements.
    await pool.query(sql);
  }
}

export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE TABLE pipeline_events RESTART IDENTITY CASCADE');
  await pool.query('TRUNCATE TABLE product_listings RESTART IDENTITY CASCADE');
  await pool.query('TRUNCATE TABLE suppliers RESTART IDENTITY CASCADE');
  await pool.query('TRUNCATE TABLE trending_products RESTART IDENTITY CASCADE');
}

