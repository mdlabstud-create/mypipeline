import { query } from '../../config/db';
import redisClient from '../../config/redis';
import { logPipelineEvent } from '../../shared/logger';
import type { SupplierCandidate } from '../../shared/types';
import { rankSuppliers, classifySla } from './ranker';
import { searchAliExpress } from './aliexpress';
import { enrichTrendingWithAmazonKeywordSearch } from './amazon.keyword.enrich';
import { shouldTripResearcherKillSwitch } from './researcher.killSwitch';
import axios from 'axios';
import { env } from '../../config/env';

type TrendingResearchRow = {
  keyword: string;
  source: string;
  amazon_asin: string | null;
  amazon_retail_usd: number | null;
};

/**
 * Researches suppliers for a product.
 *
 * Phase 2 implements the full AliExpress/Alibaba/1688 logic.
 */
export async function researchProduct(productId: string): Promise<void> {
  const enabled = await redisClient.get('pipeline:researcher:enabled');
  const enabledBool = enabled === null ? true : !(enabled === '0' || enabled === 'false');
  if (!enabledBool) {
    throw new Error('Researcher kill switch active');
  }

  const products = await query<TrendingResearchRow>(
    `SELECT keyword,
            source::text AS source,
            amazon_asin,
            amazon_retail_usd::float8 AS amazon_retail_usd
     FROM trending_products
     WHERE id = $1
     LIMIT 1`,
    [productId]
  );
  const row = products[0];
  if (!row) {
    await logPipelineEvent({
      stage: 'researcher',
      status: 'error',
      message: 'product not found',
      payload: { productId }
    });
    return;
  }

  await query('UPDATE trending_products SET status = $2 WHERE id = $1', [
    productId,
    'researching'
  ]);

  let amazonAsinForFallback =
    typeof row.amazon_asin === 'string' && row.amazon_asin.length > 0 ? row.amazon_asin : null;

  const fromTikTokDiscovery = row.source === 'tiktok' || row.source === 'both';
  const noAmazonListingYet = amazonAsinForFallback == null;

  if (fromTikTokDiscovery && noAmazonListingYet) {
    const { hit } = await enrichTrendingWithAmazonKeywordSearch({
      productId,
      keyword: row.keyword
    });
    await logPipelineEvent({
      stage: 'researcher',
      status: hit ? 'ok' : 'warn',
      message: hit
        ? 'amazon anchor from keyword (after tiktok discovery)'
        : 'amazon keyword lookup: no listing for tiktok keyword',
      productId,
      payload: hit
        ? { asin: hit.asin, amazonRetailUsd: hit.amazonRetailUsd }
        : { keyword: row.keyword.slice(0, 120) }
    });
    if (hit?.asin) amazonAsinForFallback = hit.asin;
  }

  let results: SupplierCandidate[] = [];
  let aeFailed = false;
  try {
    results = await searchAliExpress(row.keyword);
  } catch (err) {
    aeFailed = true;
    await logPipelineEvent({
      stage: 'researcher',
      status: 'warn',
      message: 'supplier search failed',
      productId,
      payload: { error: String(err) }
    });
  }

  // Amazon-as-supplier fallback is OFF by default (it does not give real arbitrage).
  // Run it before the kill switch so a successful fallback is not falsely treated as total failure.
  if (
    env.ALLOW_AMAZON_AS_SUPPLIER &&
    results.length === 0 &&
    row.source === 'amazon'
  ) {
    const fallback = await searchAmazonAsSupplier(row.keyword, amazonAsinForFallback);
    if (fallback.length > 0) {
      results.push(...fallback);
    }
  }

  await shouldTripResearcherKillSwitch({
    total: 1,
    failed: aeFailed ? 1 : 0,
    fulfilledWithResults: results.length > 0,
    backoffSeconds: 60 * 30
  });

  if (results.length === 0) {
    await query('UPDATE trending_products SET status = $2 WHERE id = $1', [
      productId,
      'error'
    ]);
    await logPipelineEvent({
      stage: 'researcher',
      status: 'error',
      message: 'no suppliers found',
      productId
    });
    return;
  }

  const ranked = rankSuppliers(results);

  // Guard: if ALL ranked suppliers are disqualified, abort content generation
  const allDisqualified = ranked.every((s) => s.slaStatus === 'disqualified');
  if (allDisqualified) {
    await query(`UPDATE trending_products SET status = 'error' WHERE id = $1`, [productId]);
    await logPipelineEvent({
      stage: 'researcher',
      status: 'warn',
      message: 'supplier_sla_failed: all suppliers disqualified by shipping SLA',
      productId,
      payload: { supplierCount: ranked.length }
    });
    return;
  }

  for (const s of ranked) {
    const slaStatus = s.slaStatus;
    const now = new Date().toISOString();
    await query(
      `INSERT INTO suppliers
        (product_id, platform, supplier_url, product_title, price_usd, price_cny, moq, rating, review_count,
         shipping_days, shipping_days_min, shipping_days_max, sla_status, sla_checked_at,
         fast_ship, supplier_score, images, vetted, rank)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        productId,
        s.platform,
        s.supplierUrl,
        s.productTitle ?? null,
        s.priceUsd,
        s.priceCny ?? null,
        s.moq,
        s.rating ?? null,
        s.reviewCount ?? 0,
        s.shippingDays ?? null,
        s.shippingDays ?? null,       // shipping_days_min (use same until we have finer data)
        s.shippingDays ?? null,       // shipping_days_max
        slaStatus,
        now,
        s.fastShip ?? false,
        s.supplierScore ?? null,
        JSON.stringify(s.images ?? []),
        false,
        s.rank ?? null
      ]
    );
  }

  await query('UPDATE trending_products SET status = $2 WHERE id = $1', [
    productId,
    'pending_content'
  ]);

  await logPipelineEvent({
    stage: 'researcher',
    status: 'ok',
    message: 'research completed',
    productId,
    payload: { suppliers: ranked.length }
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function parseUsdPrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;

  const normalized = value.replace(/,/g, '');
  const match = normalized.match(/\d+(?:\.\d{1,2})?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Pure parser for the Scrapingdog Amazon-search payload.
 *
 * Tolerates both `products[]` and `results[]` wrappings, the `image`/`imageUrl`
 * field-name split, and the `url`/`link` split. Returns null when no usable URL
 * can be derived (either from `preferUrl` or the response body).
 */
export function parseAmazonSearchResult(
  data: unknown,
  preferUrl: string | null
): SupplierCandidate | null {
  if (!isObject(data)) return null;

  const listRaw = data['products'] ?? data['results'];
  const list = Array.isArray(listRaw) ? listRaw : [];
  const first = list.find(isObject);
  if (!first) return null;

  const title = pickString(first, 'title');
  const priceUsd = parseUsdPrice(first['price']);
  if (priceUsd == null) return null;

  const imageUrl = pickString(first, 'image', 'imageUrl');
  const supplierUrl = preferUrl ?? pickString(first, 'url', 'link');
  if (!supplierUrl) return null;

  return {
    platform: 'amazon',
    supplierUrl,
    productTitle: title,
    priceUsd,
    priceCny: null,
    moq: 1,
    rating: null,
    reviewCount: 0,
    shippingDays: 5,
    fastShip: true,
    images: imageUrl ? [imageUrl] : []
  };
}

async function searchAmazonAsSupplier(
  keyword: string,
  asin: string | null
): Promise<SupplierCandidate[]> {
  try {
    const preferUrl = asin ? `https://www.amazon.com/dp/${asin}` : null;

    const res = await axios.get('https://api.scrapingdog.com/amazon/search', {
      params: {
        api_key: env.SCRAPINGDOG_API_KEY,
        domain: 'com',
        query: keyword,
        country: 'us',
        page: 1
      },
      timeout: 30_000
    });

    const candidate = parseAmazonSearchResult(res.data, preferUrl);
    return candidate ? [candidate] : [];
  } catch {
    return [];
  }
}

export { shouldTripResearcherKillSwitch } from './researcher.killSwitch';
