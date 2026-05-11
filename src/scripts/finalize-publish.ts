import 'dotenv/config';

import axios from 'axios';
import { env } from '../config/env';
import { query } from '../config/db';
import logger from '../shared/logger';
import { handleImages } from '../modules/content-generator/images';
import { publishToShopify } from '../modules/publisher/shopify.service';

type Source = 'amazon' | 'any';

function getArg(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function toInt(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function uniq<T>(arr: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const x of arr) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function extractAmazonAsin(url: string): string | null {
  const m =
    url.match(/\/dp\/([A-Z0-9]{10})/i) ??
    url.match(/\/gp\/product\/([A-Z0-9]{10})/i) ??
    url.match(/asin=([A-Z0-9]{10})/i);
  return m && m[1] ? m[1].toUpperCase() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchAmazonImages(asin: string): Promise<string[]> {
  const res = await axios.get('https://api.scrapingdog.com/amazon/product', {
    params: {
      api_key: env.SCRAPINGDOG_API_KEY,
      domain: 'com',
      asin,
      country: 'us'
    },
    timeout: 30_000
  });

  const data: unknown = res.data;
  const imagesRaw = isRecord(data) ? data['images'] : undefined;
  const imgs = Array.isArray(imagesRaw) ? imagesRaw : [];
  return imgs.filter((x): x is string => typeof x === 'string' && /^https:\/\//i.test(x));
}

async function ensureListingHasMinImages(params: {
  listingId: string;
  minImages: number;
}): Promise<void> {
  const { listingId, minImages } = params;

  const rows = await query<{
    listing_id: string;
    listing_images: unknown;
    supplier_images: unknown;
    supplier_url: string;
    platform: string;
    amazon_asin: string | null;
  }>(
    `SELECT
       pl.id as listing_id,
       pl.images as listing_images,
       s.images as supplier_images,
       s.supplier_url,
       s.platform,
       tp.amazon_asin
     FROM product_listings pl
     JOIN suppliers s ON s.id = pl.supplier_id
     LEFT JOIN trending_products tp ON tp.id = pl.product_id
     WHERE pl.id = $1
     LIMIT 1`,
    [listingId]
  );

  const row = rows[0];
  if (!row) return;

  const listingImgs: string[] = (() => {
    if (Array.isArray(row.listing_images)) return row.listing_images.filter((x): x is string => typeof x === 'string');
    if (typeof row.listing_images === 'string') {
      try {
        const parsed = JSON.parse(row.listing_images) as unknown;
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
      } catch {
        return [];
      }
    }
    return [];
  })();

  if (listingImgs.length >= minImages) return;

  const supplierImgs: string[] = (() => {
    if (Array.isArray(row.supplier_images)) return row.supplier_images.filter((x): x is string => typeof x === 'string');
    if (typeof row.supplier_images === 'string') {
      try {
        const parsed = JSON.parse(row.supplier_images) as unknown;
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
      } catch {
        return [];
      }
    }
    return [];
  })();

  let candidateImgs = supplierImgs;

  if (candidateImgs.length < minImages && String(row.platform) === 'amazon') {
    const asin = row.amazon_asin ?? extractAmazonAsin(row.supplier_url);
    if (asin) {
      const amazonImgs = await fetchAmazonImages(asin);
      candidateImgs = uniq([...candidateImgs, ...amazonImgs]);
      await query('UPDATE suppliers SET images = $2 WHERE id = (SELECT supplier_id FROM product_listings WHERE id = $1)', [
        listingId,
        JSON.stringify(candidateImgs)
      ]);
    }
  }

  // Upload to Cloudinary when possible; otherwise fall back to HTTPS originals.
  const processed = await handleImages(candidateImgs);
  let finalImgs = uniq(processed).filter((x) => /^https:\/\//i.test(x));

  if (finalImgs.length < minImages && finalImgs.length > 0) {
    const last = finalImgs[finalImgs.length - 1];
    if (last) {
      while (finalImgs.length < minImages) finalImgs.push(last);
    }
  }

  if (finalImgs.length >= minImages) {
    await query('UPDATE product_listings SET images = $2, updated_at = now() WHERE id = $1', [
      listingId,
      JSON.stringify(finalImgs.slice(0, Math.min(12, Math.max(minImages, finalImgs.length))))
    ]);
    logger.info('listing_images_backfilled', { listingId, count: finalImgs.length });
  } else {
    logger.warn('unable_to_backfill_min_images', { listingId, have: finalImgs.length, need: minImages });
  }
}

async function approveListing(listingId: string, reviewedBy: string): Promise<void> {
  await query(
    `UPDATE product_listings
     SET status='approved', reviewed_by=$2, reviewed_at=now()
     WHERE id=$1 AND status IN ('pending_review','approved')`,
    [listingId, reviewedBy]
  );
}

async function main(): Promise<void> {
  const limit = toInt(getArg('limit'), 1000);
  const minImages = toInt(getArg('minImages'), 5);
  const reviewedBy = getArg('reviewedBy') ?? 'pipeline-finalize';
  const source = (getArg('source') as Source) ?? 'amazon';
  const shopifyStatus = (getArg('shopifyStatus') as 'ACTIVE' | 'DRAFT' | undefined) ?? 'ACTIVE';

  logger.info('finalize-publish starting', { limit, minImages, reviewedBy, source, shopifyStatus });

  const rows = await query<{ id: string; status: string }>(
    `SELECT pl.id, pl.status
     FROM product_listings pl
     LEFT JOIN trending_products tp ON tp.id = pl.product_id
     WHERE pl.status IN ('pending_review','approved','published')
       AND ($1::text = 'any' OR tp.source = $1::text)
     ORDER BY pl.created_at ASC
     LIMIT $2`,
    [source, limit]
  );

  for (const r of rows) {
    // Ensure images first, then publish/update.
    await ensureListingHasMinImages({ listingId: r.id, minImages });

    // Approve + publish pending_review / approved listings
    await approveListing(r.id, reviewedBy);

    const current = await query<{ status: string; shopify_id: string | null }>(
      'SELECT status, shopify_id FROM product_listings WHERE id = $1 LIMIT 1',
      [r.id]
    );
    const status = current[0]?.status ?? 'error';
    const shopifyId = current[0]?.shopify_id ?? null;

    if (status === 'approved' && !shopifyId) {
      await publishToShopify(r.id, { shopifyStatus });
    }
  }

  logger.info('finalize-publish complete', { processed: rows.length });
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

