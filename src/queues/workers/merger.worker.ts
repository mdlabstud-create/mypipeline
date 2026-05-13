import { Worker, type Job } from 'bullmq';
import redisClient from '../../config/redis';
import { env } from '../../config/env';
import { query } from '../../config/db';
import logger, { logPipelineEvent } from '../../shared/logger';
import { runMerger } from '../../modules/merger/merger.service';
import { scoreViabilityQueue } from '../pipeline.queue';
import type { MergeProductsJobData } from '../pipeline.queue';

async function hasListingInFlight(productId: string): Promise<boolean> {
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM product_listings
     WHERE product_id = $1
       AND status IN ('pending_review', 'approved', 'published')`,
    [productId]
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * Merger worker.
 */
export function startMergerWorker(): Worker {
  const worker = new Worker(
    'merge-products',
    async () => {
      const productIds = await runMerger();
      const target =
        env.MERGER_MAX_RESEARCH_PER_RUN > 0 ? env.MERGER_MAX_RESEARCH_PER_RUN : productIds.length;

      let queued = 0;
      let skipped = 0;
      for (const productId of productIds) {
        if (queued >= target) break;
        if (await hasListingInFlight(productId)) {
          skipped += 1;
          continue;
        }
        await scoreViabilityQueue.add('score-viability', { productId });
        queued += 1;
      }

      await logPipelineEvent({
        stage: 'merger-worker',
        status: 'ok',
        message: 'viability scorer jobs enqueued (deduped)',
        payload: { offered: productIds.length, queued, skipped, target }
      });
    },
    { connection: redisClient, concurrency: 1 }
  );

  worker.on('failed', (job: Job<MergeProductsJobData> | undefined, error: Error) => {
    void (async () => {
      logger.error('merger worker failed', { jobId: job?.id, error });
      await logPipelineEvent({
        stage: 'merger-worker',
        status: 'error',
        message: 'merger worker failed',
        payload: { jobId: job?.id, error: String(error) }
      });
    })();
  });

  return worker;
}