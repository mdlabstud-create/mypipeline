import redisClient from '../config/redis';
import { mergeProductsQueue } from './pipeline.queue';

async function enqueueMerge(triggeredAt: string): Promise<void> {
  await mergeProductsQueue.add('merge-products', {
    triggeredAt
  });
}

/**
 * Tracks completion of parallel scrapers (Amazon + TikTok).
 *
 * Each scraper reports exactly once per day so we can enqueue the merger even if one scraper fails,
 * as long as both attempts have finished.
 */
export async function recordScraperFinished(params: {
  scraper: 'amazon' | 'tiktok';
  triggeredAt: string;
}): Promise<void> {
  const day = params.triggeredAt.slice(0, 10);

  const keyAmazon = `pipeline:scraper_done:amazon:${day}`;
  const keyTiktok = `pipeline:scraper_done:tiktok:${day}`;
  const keyMerge = `pipeline:merge_enqueued:${day}`;

  const ttlSeconds = 60 * 60 * 24;

  await redisClient.set(params.scraper === 'amazon' ? keyAmazon : keyTiktok, '1', 'EX', ttlSeconds);

  const [amazonDone, tiktokDone] = await Promise.all([
    redisClient.get(keyAmazon),
    redisClient.get(keyTiktok)
  ]);

  if (!(amazonDone && tiktokDone)) return;

  const enqueued = await redisClient.set(keyMerge, '1', 'EX', ttlSeconds, 'NX');
  if (enqueued !== 'OK') return;

  await enqueueMerge(params.triggeredAt);
}
