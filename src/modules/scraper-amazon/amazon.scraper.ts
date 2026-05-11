import axios from 'axios';
import { amazonCategories, env } from '../../config/env';
import { query } from '../../config/db';
import logger, { logPipelineEvent } from '../../shared/logger';
import { ScraperError } from '../../shared/errors';
import { calculateAmazonScore, normalizeAmazonKeyword, parseAmazonItems } from './amazon.parser';

function scrapingdogAmazonSearchQuery(category: string): string {
  switch (category) {
    case 'Electronics':
      return 'electronics amazon best sellers';
    case 'HomeAndKitchen':
      return 'kitchen amazon best sellers';
    case 'ToysAndGames':
      return 'toys amazon best sellers';
    case 'BeautyPersonalCare':
      return 'beauty amazon best sellers';
    default:
      return `${category.replace(/([A-Z])/g, ' $1').trim()} amazon best sellers`;
  }
}

/**
 * Runs the Amazon best sellers scraper and persists results to the DB.
 */
export async function runAmazonScraper(): Promise<number> {
  let stored = 0;

  try {
    for (const category of amazonCategories) {
      await logPipelineEvent({
        stage: 'amazon-scraper',
        status: 'ok',
        message: 'starting category scrape',
        payload: { category }
      });

      const url = 'https://api.scrapingdog.com/amazon/search';
      const params = {
        api_key: env.SCRAPINGDOG_API_KEY,
        domain: 'com',
        query: scrapingdogAmazonSearchQuery(category),
        page: '1',
        country: 'us'
      };

      let data: unknown;
      try {
        const res = await axios.get(url, { params, timeout: 30_000 });
        data = res.data;
      } catch (error: unknown) {
        // One retry on 429.
        const status =
          typeof error === 'object' &&
          error !== null &&
          'response' in error &&
          typeof (error as { response?: { status?: unknown } }).response?.status ===
            'number'
            ? (error as { response: { status: number } }).response.status
            : undefined;

        if (status === 429) {
          await new Promise((r) => setTimeout(r, 30_000));
          const res = await axios.get(url, { params, timeout: 30_000 });
          data = res.data;
        } else {
          throw error;
        }
      }

      const parsed = parseAmazonItems(data);
      const categoryStoredBefore = stored;
      for (const item of parsed) {
        if (item.bestSellerRank > env.AMAZON_MAX_BSR) continue;

        const keyword = normalizeAmazonKeyword(item.title);
        if (!keyword) continue;

        const amazonScore = calculateAmazonScore(item.bestSellerRank, env.AMAZON_MAX_BSR);
        const amazonRetail =
          item.price != null && Number.isFinite(item.price) && item.price > 0 ? item.price : null;

        await query(
          `INSERT INTO trending_products
            (keyword, source, amazon_asin, amazon_bsr, amazon_score, trend_score, status, amazon_retail_usd)
           VALUES ($1, 'amazon', $2, $3, $4, $5, 'pending_research', $6)
           ON CONFLICT (keyword) DO UPDATE SET
             amazon_asin = EXCLUDED.amazon_asin,
             amazon_bsr = EXCLUDED.amazon_bsr,
             amazon_score = EXCLUDED.amazon_score,
             amazon_retail_usd = COALESCE(EXCLUDED.amazon_retail_usd, trending_products.amazon_retail_usd),
             source = CASE
               WHEN trending_products.source = 'tiktok' THEN 'both'
               ELSE trending_products.source
             END,
             trend_score = GREATEST(trending_products.trend_score, EXCLUDED.trend_score),
             status = CASE
               WHEN trending_products.status IN (
                 'pending_review', 'approved', 'published', 'duplicate',
                 'generating', 'pending_content', 'researching', 'rejected'
               ) THEN trending_products.status
               ELSE 'pending_research'
             END`,
          [keyword, item.asin, item.bestSellerRank, amazonScore, amazonScore, amazonRetail]
        );
        stored += 1;
      }

      await logPipelineEvent({
        stage: 'amazon-scraper',
        status: 'ok',
        message: 'category scrape completed',
        payload: { category, stored, newItems: stored - categoryStoredBefore }
      });
    }

    return stored;
  } catch (error: unknown) {
    logger.error('amazon scraper failed', { error });
    await logPipelineEvent({
      stage: 'amazon-scraper',
      status: 'error',
      message: 'amazon scraper failed',
      payload: { error: String(error) }
    });
    throw new ScraperError('Amazon scraper failed', 'amazon', true);
  }
}