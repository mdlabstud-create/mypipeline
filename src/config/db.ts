import { Pool, type QueryResultRow } from 'pg';
import logger from '../shared/logger';
import { env } from './env';

/**
 * Shared PostgreSQL connection pool for the pipeline.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000
});

pool.on('error', (error: Error) => {
  logger.error('postgres pool error', { error });
});

/**
 * Typed query wrapper around node-postgres.
 */
export async function query<T extends QueryResultRow>(
  sql: string,
  params: ReadonlyArray<unknown> = []
): Promise<T[]> {
  const res = await pool.query<T>(sql, params as unknown[]);
  return res.rows;
}
