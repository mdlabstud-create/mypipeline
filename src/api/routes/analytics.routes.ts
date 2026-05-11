import { Router } from 'express';
import { query } from '../../config/db';

export const analyticsRouter = Router();

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return 0;
}

analyticsRouter.get('/', async (_req, res, next) => {
  try {
    const daily = await query<{ date: string; count: string }>(
      `SELECT to_char(created_at::date, 'YYYY-MM-DD') as date, COUNT(*)::text as count
       FROM trending_products
       WHERE created_at > now() - interval '7 days'
       GROUP BY created_at::date
       ORDER BY created_at::date ASC`
    );

    const approval = await query<{ approval_rate: string }>(
      `SELECT CASE WHEN (COUNT(*) FILTER (WHERE status IN ('approved','rejected'))) = 0
         THEN '0'
         ELSE ((COUNT(*) FILTER (WHERE status='approved')::float /
               (COUNT(*) FILTER (WHERE status IN ('approved','rejected')))::float) * 100)::text
       END AS approval_rate
       FROM product_listings
       WHERE created_at > now() - interval '7 days'`
    );

    const avgMarginByTag = await query<{ tag: string; avg_margin: string }>(
      `SELECT unnest(tags) as tag, COALESCE(AVG(margin_pct),0)::text as avg_margin
       FROM product_listings
       WHERE created_at > now() - interval '7 days'
       GROUP BY tag
       ORDER BY avg_margin DESC
       LIMIT 20`
    );

    const sourceBreakdown = await query<{ source: string; pct: string }>(
      `SELECT source,
         (COUNT(*)::float / NULLIF((SELECT COUNT(*) FROM trending_products WHERE created_at > now() - interval '7 days'),0)::float * 100)::text as pct
       FROM trending_products
       WHERE created_at > now() - interval '7 days'
       GROUP BY source`
    );

    res.json({
      dailyProducts: daily.map((d) => ({ date: d.date, count: toNumber(d.count) })),
      approvalRate: toNumber(approval[0]?.approval_rate),
      avgMarginByCategory: avgMarginByTag.map((r) => ({
        tag: r.tag,
        avgMargin: toNumber(r.avg_margin)
      })),
      sourceBreakdown: Object.fromEntries(
        sourceBreakdown.map((r) => [r.source, toNumber(r.pct)])
      )
    });
  } catch (e: unknown) {
    next(e);
  }
});
