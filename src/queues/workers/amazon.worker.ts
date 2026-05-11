import { Worker, type Job } from 'bullmq';
import redisClient from '../../config/redis';
import logger, { logPipelineEvent } from '../../shared/logger';
import { runAmazonScraper } from '../../modules/scraper-amazon/amazon.scraper';
import type { AmazonScrapeJobData } from '../pipeline.queue';
import { recordScraperFinished } from '../scrapers-done';

/**
 * Amazon scrape worker.
 */
export function startAmazonWorker(): Worker {
  const worker = new Worker(
    'amazon-scrape',
    async (job: Job<AmazonScrapeJobData>) => {
      const triggeredAt = job.data.triggeredAt ?? new Date().toISOString();
      await runAmazonScraper();
      await recordScraperFinished({ scraper: 'amazon', triggeredAt });
    },
    { connection: redisClient, concurrency: 1 }
  );

  worker.on('failed', (job: Job<AmazonScrapeJobData> | undefined, error: Error) => {
    void (async () => {
      logger.error('amazon worker failed', { jobId: job?.id, error });
      await logPipelineEvent({
        stage: 'amazon-worker',
        status: 'error',
        message: 'amazon worker failed',
        payload: { jobId: job?.id, error: String(error) }
      });
    })();
  });

  return worker;
}