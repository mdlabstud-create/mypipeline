import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import logger from '../shared/logger';
import { pool } from '../config/db';

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getApplied(): Promise<Set<string>> {
  const res = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(res.rows.map((r) => r.filename));
}

async function applyOne(filename: string, sql: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getApplied();

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  for (const filename of files) {
    if (applied.has(filename)) continue;
    const full = path.join(migrationsDir, filename);
    const sql = await readFile(full, 'utf8');
    logger.info('applying migration', { filename });
    await applyOne(filename, sql);
  }

  logger.info('migrations complete', { total: files.length });
}

async function main(): Promise<void> {
  try {
    await runMigrations();
    await pool.end();
  } catch (error: unknown) {
    logger.error('migration failed', { error });
    process.exit(1);
  }
}

// Only run when invoked as a script.
if (require.main === module) {
  void main();
}

