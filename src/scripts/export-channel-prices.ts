/**
 * One row per listing: Amazon anchor, TikTok scrape price (when captured), supplier cost, store retail.
 */
import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';

import { query } from '../config/db';
import logger from '../shared/logger';

type Row = {
  title: string;
  listing_id: string;
  listing_status: string;
  product_keyword: string;
  trend_source: string;
  amazon_asin: string | null;
  amazon_retail_usd: number | null;
  tiktok_retail_usd: number | null;
  tiktok_hashtag: string | null;
  tiktok_views: string | null;
  supplier_platform: string;
  supplier_cost_usd: number;
  store_retail_usd: number;
  margin_pct: number;
  shopify_id: string | null;
};

function getArg(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main(): Promise<void> {
  const statusFilter = (getArg('status') ?? 'published').toLowerCase();
  const format = (getArg('format') ?? 'csv').toLowerCase();
  const outPath = getArg('out');

  const allowed = new Set(['published', 'all']);
  if (!allowed.has(statusFilter)) {
    console.error('Unknown --status (use published | all)');
    process.exit(1);
  }

  const whereStatus = statusFilter === 'all' ? '' : `WHERE pl.status = 'published'`;

  const rows = await query<Row>(
    `SELECT pl.title,
            pl.id::text AS listing_id,
            pl.status AS listing_status,
            tp.keyword AS product_keyword,
            tp.source::text AS trend_source,
            tp.amazon_asin::text AS amazon_asin,
            tp.amazon_retail_usd::float8 AS amazon_retail_usd,
            tp.tiktok_retail_usd::float8 AS tiktok_retail_usd,
            tp.tiktok_hashtag::text AS tiktok_hashtag,
            tp.tiktok_views::text AS tiktok_views,
            s.platform::text AS supplier_platform,
            s.price_usd::float8 AS supplier_cost_usd,
            pl.retail_usd::float8 AS store_retail_usd,
            pl.margin_pct::float8 AS margin_pct,
            pl.shopify_id::text AS shopify_id
     FROM product_listings pl
     JOIN trending_products tp ON tp.id = pl.product_id
     JOIN suppliers s ON s.id = pl.supplier_id
     ${whereStatus}
     ORDER BY pl.published_at DESC NULLS LAST, pl.updated_at DESC`
  );

  const header = [
    'title',
    'listing_id',
    'listing_status',
    'product_keyword',
    'trend_source',
    'amazon_asin',
    'amazon_retail_usd',
    'tiktok_retail_usd',
    'tiktok_hashtag',
    'tiktok_views',
    'supplier_platform',
    'supplier_cost_usd',
    'store_retail_usd',
    'margin_pct',
    'shopify_product_gid'
  ].join(',');

  let body: string;

  if (format === 'json') {
    body = JSON.stringify(rows, null, 2);
  } else if (format === 'csv') {
    body = [
      header,
      ...rows.map((r) =>
        [
          csvEscape(r.title ?? ''),
          r.listing_id,
          r.listing_status,
          csvEscape(r.product_keyword ?? ''),
          r.trend_source,
          r.amazon_asin ?? '',
          r.amazon_retail_usd ?? '',
          r.tiktok_retail_usd ?? '',
          r.tiktok_hashtag ?? '',
          r.tiktok_views ?? '',
          r.supplier_platform,
          r.supplier_cost_usd,
          r.store_retail_usd,
          r.margin_pct,
          r.shopify_id ?? ''
        ].join(',')
      )
    ].join('\n');
  } else {
    console.error('Unknown --format (use csv | json)');
    process.exit(1);
  }

  const text = body + '\n';

  if (outPath) {
    const abs = path.isAbsolute(outPath) ? outPath : path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
    logger.info('export-channel-prices written', { path: abs, rows: rows.length, statusFilter });
  } else {
    process.stdout.write(text);
    logger.info('export-channel-prices to stdout', { rows: rows.length, statusFilter });
  }
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
