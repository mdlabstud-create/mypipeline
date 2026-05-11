import axios, { isAxiosError } from 'axios';

import { env } from '../../config/env';
import { calculateAmazonScore, parseAmazonItems } from '../scraper-amazon/amazon.parser';
import { query } from '../../config/db';
import logger from '../../shared/logger';

export type AmazonKeywordSearchHit = {
  asin: string;
  bsr: number;
  amazonScore: number;
  amazonRetailUsd: number | null;
};

/**
 * ScrapingDog Amazon search scoped to one keyword (stem phrase from TikTok or free text).
 * Returns the top parsed organic-ish hit with ASIN; price may be null depending on payload.
 */
export async function lookupAmazonListingForKeyword(
  keyword: string
): Promise<AmazonKeywordSearchHit | null> {
  const q = keyword.trim();
  if (q.length < 2) return null;

  const url = 'https://api.scrapingdog.com/amazon/search';
  const params = {
    api_key: env.SCRAPINGDOG_API_KEY,
    domain: 'com',
    query: q,
    country: 'us',
    page: '1'
  };

  let data: unknown;
  try {
    const res = await axios.get(url, { params, timeout: 30_000 });
    data = res.data;
  } catch (error: unknown) {
    if (isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 429) {
        await new Promise((r) => setTimeout(r, 30_000));
        const res = await axios.get(url, { params, timeout: 30_000 });
        data = res.data;
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  const parsed = parseAmazonItems(data);
  const first = parsed[0];
  if (!first) return null;

  const price =
    first.price != null && Number.isFinite(first.price) && first.price > 0 ? first.price : null;

  return {
    asin: first.asin,
    bsr: first.bestSellerRank,
    amazonScore: calculateAmazonScore(first.bestSellerRank, env.AMAZON_MAX_BSR),
    amazonRetailUsd: price
  };
}

/**
 * For TikTok-originated trends: try Amazon search by the same keyword and persist anchor fields
 * before supplier (AliExpress) research runs.
 */
export async function enrichTrendingWithAmazonKeywordSearch(params: {
  productId: string;
  keyword: string;
}): Promise<{ hit: AmazonKeywordSearchHit | null }> {
  try {
    const hit = await lookupAmazonListingForKeyword(params.keyword);
    if (!hit) {
      logger.info('amazon keyword enrich: no match', {
        productId: params.productId,
        keyword: params.keyword
      });
      return { hit: null };
    }

    await query(
      `UPDATE trending_products
       SET amazon_asin = $2,
           amazon_bsr = $3,
           amazon_score = $4,
           amazon_retail_usd = CASE
             WHEN $5::numeric IS NOT NULL THEN $5::numeric
             ELSE amazon_retail_usd
           END,
           source = CASE
             WHEN source = 'tiktok' THEN 'both'
             ELSE source
           END,
           updated_at = now()
       WHERE id = $1`,
      [
        params.productId,
        hit.asin,
        hit.bsr,
        hit.amazonScore,
        hit.amazonRetailUsd
      ]
    );

    logger.info('amazon keyword enrich: updated trending row', {
      productId: params.productId,
      asin: hit.asin,
      retailUsd: hit.amazonRetailUsd
    });

    return { hit };
  } catch (error: unknown) {
    logger.warn('amazon keyword enrich failed', {
      productId: params.productId,
      error: String(error)
    });
    return { hit: null };
  }
}
