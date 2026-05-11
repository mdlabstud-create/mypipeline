import { Worker, type Job } from 'bullmq';
import redisClient from '../../config/redis';
import logger, { logPipelineEvent } from '../../shared/logger';
import { runTikTokScraper } from '../../modules/scraper-tiktok/tiktok.scraper';
import type { TikTokScrapeJobData } from '../pipeline.queue';
import { recordScraperFinished } from '../scrapers-done';

/**
 * TikTok scrape worker.
 */
export function startTikTokWorker(): Worker {
  const worker = new Worker(
    'tiktok-scrape',
    async (job: Job<TikTokScrapeJobData>) => {
      const triggeredAt = job.data.triggeredAt ?? new Date().toISOString();
      await runTikTokScraper();
      await recordScraperFinished({ scraper: 'tiktok', triggeredAt });
    },
    { connection: redisClient, concurrency: 1 }
  );

  worker.on('failed', (job: Job<TikTokScrapeJobData> | undefined, error: Error) => {
    void (async () => {
      logger.error('tiktok worker failed', { jobId: job?.id, error });
      await logPipelineEvent({
        stage: 'tiktok-worker',
        status: 'error',
        message: 'tiktok worker failed',
        payload: { jobId: job?.id, error: String(error) }
      });
    })();
  });

  return worker;
}