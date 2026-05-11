import { Router } from 'express';
import { query } from '../../config/db';

export const metricsRouter = Router();

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return 0;
}

metricsRouter.get('/', async (_req, res, next) => {
  try {
    const found = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM trending_products
       WHERE created_at::date = now()::date`
    );
    const pending = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM product_listings
       WHERE status = 'pending_review'`
    );
    const published = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM product_listings
       WHERE published_at::date = now()::date`
    );
    const avgMargin = await query<{ avg: string }>(
      `SELECT COALESCE(AVG(margin_pct), 0)::text AS avg
       FROM product_listings
       WHERE published_at::date = now()::date`
    );

    res.json({
      productsFoundToday: toNumber(found[0]?.count),
      pendingReview: toNumber(pending[0]?.count),
      publishedToday: toNumber(published[0]?.count),
      avgMarginPct: toNumber(avgMargin[0]?.avg)
    });
  } catch (e: unknown) {
    next(e);
  }
});
