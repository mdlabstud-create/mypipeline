import { ApifyClient } from 'apify-client';
import { env, tiktokHashtags } from '../../config/env';
import { query } from '../../config/db';
import logger, { logPipelineEvent } from '../../shared/logger';
import { calculateTikTokScore, normalizeTikTokKeyword, parseTikTokItems } from './tiktok.parser';

/**
 * Runs the TikTok scraper and persists results to the DB.
 */
export async function runTikTokScraper(): Promise<number> {
  const client = new ApifyClient({ token: env.APIFY_API_TOKEN });
  let stored = 0;

  try {
    for (const hashtag of tiktokHashtags) {
      // Actor `clockworks/tiktok-hashtag-scraper` expects `hashtags` (array), not `hashtag`.
      const input = { hashtags: [hashtag], maxItems: 100 };

      await logPipelineEvent({
        stage: 'tiktok-scraper',
        status: 'ok',
        message: 'starting hashtag scrape',
        payload: { hashtag }
      });

      const run = await client
        .actor('clockworks/tiktok-hashtag-scraper')
        .call(input);

      const datasetId = run.defaultDatasetId;
      if (!datasetId) continue;

      const { items } = await client.dataset(datasetId).listItems();
      const parsed = parseTikTokItems(items);

      for (const item of parsed) {
        if (item.playCount < env.TIKTOK_MIN_VIEWS) continue;

        const keyword = normalizeTikTokKeyword(item.desc);
        if (!keyword) continue;

        const score = calculateTikTokScore(item.playCount);

        await query(
          `INSERT INTO trending_products
            (keyword, source, tiktok_score, tiktok_views, tiktok_hashtag, tiktok_retail_usd, trend_score, status)
           VALUES ($1, 'tiktok', $2, $3, $4, $5, $6, 'pending_research')
           ON CONFLICT (keyword) DO UPDATE SET
             tiktok_score = EXCLUDED.tiktok_score,
             tiktok_views = EXCLUDED.tiktok_views,
             tiktok_hashtag = EXCLUDED.tiktok_hashtag,
             tiktok_retail_usd = COALESCE(EXCLUDED.tiktok_retail_usd, trending_products.tiktok_retail_usd),
             source = CASE
               WHEN trending_products.source = 'amazon' THEN 'both'
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
          [keyword, score, item.playCount, hashtag, item.tiktokRetailUsd ?? null, score]
        );
        stored += 1;
      }

      await logPipelineEvent({
        stage: 'tiktok-scraper',
        status: 'ok',
        message: 'hashtag scrape completed',
        payload: { hashtag, stored }
      });
    }

    return stored;
  } catch (error: unknown) {
    logger.error('tiktok scraper failed', { error });
    await logPipelineEvent({
      stage: 'tiktok-scraper',
      status: 'warn',
      message: 'tiktok scraper skipped (Apify error) — continuing pipeline with other sources',
      payload: { error: String(error), stored }
    });
    // Don't throw: the daily run should still proceed when TikTok is quota-blocked.
    return stored;
  }
}