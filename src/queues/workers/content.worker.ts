import { Worker, type Job } from 'bullmq';
import redisClient from '../../config/redis';
import { env } from '../../config/env';
import { query } from '../../config/db';
import logger, { logPipelineEvent } from '../../shared/logger';
import { generateContent } from '../../modules/content-generator/content.service';
import { publishProductQueue } from '../pipeline.queue';
import type { GenerateContentJobData } from '../pipeline.queue';

/**
 * Content generation worker.
 */
export function startContentWorker(): Worker {
  const worker = new Worker(
    'generate-content',
    async (job: Job<GenerateContentJobData>) => {
      const listingId = await generateContent(job.data.productId);
      if (!listingId) return;

      if (env.AUTO_PUBLISH) {
        const upd = await query<{ id: string }>(
          `UPDATE product_listings
           SET status = 'approved', reviewed_by = $2, reviewed_at = now()
           WHERE id = $1 AND status = 'pending_review'
           RETURNING id`,
          [listingId, 'auto-publish']
        );
        if (upd[0]) {
          await publishProductQueue.add('publish-product', {
            listingId,
            shopifyStatus: 'ACTIVE'
          });
        }
      }
    },
    { connection: redisClient, concurrency: 2 }
  );

  worker.on('failed', (job: Job<GenerateContentJobData> | undefined, error: Error) => {
    void (async () => {
      logger.error('content worker failed', { jobId: job?.id, error });
      await logPipelineEvent({
        stage: 'content-worker',
        status: 'error',
        message: 'content worker failed',
        payload: { jobId: job?.id, error: String(error) }
      });
    })();
  });

  return worker;
}