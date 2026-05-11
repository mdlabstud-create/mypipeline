import 'dotenv/config';

import { query } from '../config/db';
import logger from '../shared/logger';
import { researchSuppliersQueue } from '../queues/pipeline.queue';

function getArg(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function toFloat(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Adds `research-suppliers` jobs for scoring candidates (prioritize higher Amazon anchors
 * — margin-under the 0.65×Amazon rule is easier when anchor is bigger vs noisy search costs).
 */
async function main(): Promise<void> {
  const limit = toInt(getArg('limit'), 80);
  const rawMinAmazon = getArg('minAmazonUsd');
  const hasMinAmazon = rawMinAmazon != null && rawMinAmazon.length > 0;
  const minAmazonUsd = hasMinAmazon ? toFloat(rawMinAmazon, 0) : null;

  const statuses = (
    getArg('status') ??
    // Default: unexplored or stuck after content skip (still has suppliers)
    'pending_research,pending_content'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const placeholders = statuses.map((_, i) => `$${i + 2}::text`).join(', ');
  const minBindIdx = statuses.length + 2;
  const fullMinClause =
    hasMinAmazon && minAmazonUsd != null
      ? `AND amazon_retail_usd IS NOT NULL AND amazon_retail_usd >= $${minBindIdx}`
      : '';

  const sql = `
    SELECT id
      FROM trending_products
     WHERE status IN (${placeholders})
       ${fullMinClause}
     ORDER BY amazon_retail_usd DESC NULLS LAST, trend_score DESC, created_at DESC
     LIMIT $1
  `;
  const params: unknown[] = [limit, ...statuses];
  if (hasMinAmazon && minAmazonUsd != null) params.push(minAmazonUsd);

  const rows = await query<{ id: string }>(sql, params);

  let n = 0;
  for (const r of rows) {
    await researchSuppliersQueue.add('research-suppliers', { productId: r.id });
    n += 1;
  }

  logger.info('enqueue-research complete', { queued: n, limit, statuses, minAmazonUsd: minAmazonUsd ?? null });
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
