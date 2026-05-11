/**
 * Recomputes `retail_usd` + `margin_pct` on existing rows using `calculatePricing`
 * (Amazon anchor × ratio when present, else markup × cost, then MIN_MARGIN guard).
 */
import 'dotenv/config';

import { query } from '../config/db';
import { env } from '../config/env';
import { calculatePricing } from '../modules/content-generator/pricing';
import logger from '../shared/logger';

async function main(): Promise<void> {
  const rows = await query<{
    id: string;
    cost_usd: number;
    amazon_retail_usd: number | null;
  }>(
    `SELECT pl.id,
            s.price_usd::float8 AS cost_usd,
            tp.amazon_retail_usd::float8 AS amazon_retail_usd
     FROM product_listings pl
     JOIN suppliers s ON s.id = pl.supplier_id
     JOIN trending_products tp ON tp.id = pl.product_id
     WHERE pl.status = 'published'`
  );

  let n = 0;
  for (const r of rows) {
    const anchor =
      r.amazon_retail_usd != null && Number.isFinite(r.amazon_retail_usd)
        ? r.amazon_retail_usd
        : null;
    const p = calculatePricing(r.cost_usd, {
      markupMultiplier: env.MARKUP_MULTIPLIER,
      minMarginPct: env.MIN_MARGIN_PCT,
      amazonRetailAnchorUsd: anchor,
      storeVsAmazonRatio: env.STORE_VS_AMAZON_RATIO
    });
    await query(
      `UPDATE product_listings
       SET retail_usd = $2, margin_pct = $3, updated_at = now()
       WHERE id = $1`,
      [r.id, p.retailUsd, p.marginPct]
    );
    n += 1;
  }
  logger.info('recompute-listing-prices done', { updated: n });
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
