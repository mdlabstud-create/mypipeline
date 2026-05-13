import { Worker, type Job } from 'bullmq';
import redisClient from '../../config/redis';
import logger, { logPipelineEvent } from '../../shared/logger';
import { scoreProductViability } from '../../modules/viability/viability.service';
import { researchSuppliersQueue } from '../pipeline.queue';
import { query } from '../../config/db';
import type { ScoreViabilityJobData } from '../pipeline.queue';

export function startViabilityScorerWorker(): Worker {
  const worker = new Worker(
    'score-viability',
    async (job: Job<ScoreViabilityJobData>) => {
      const enabled = await redisClient.get('pipeline:viability-scorer:enabled');
      const enabledBool = enabled === null ? true : !(enabled === '0' || enabled === 'false');
      if (!enabledBool) {
        logger.warn('viability scorer kill switch active', { productId: job.data.productId });
        return;
      }

      await scoreProductViability(job.data.productId);

      // Only enqueue research for viable products
      const rows = await query<{ viability_status: string }>(
        'SELECT viability_status FROM trending_products WHERE id = $1 LIMIT 1',
        [job.data.productId]
      );
      const status = rows[0]?.viability_status ?? 'rejected';

      if (status === 'viable') {
        await researchSuppliersQueue.add('research-suppliers', { productId: job.data.productId });
      } else {
        await logPipelineEvent({
          stage: 'viability-scorer',
          status: 'warn',
          message: `product not viable — skipping research (${status})`,
          productId: job.data.productId
        });
      }
    },
    { connection: redisClient, concurrency: 3 }
  );

  worker.on('failed', (job: Job<ScoreViabilityJobData> | undefined, error: Error) => {
    void (async () => {
      logger.error('viability scorer worker failed', { jobId: job?.id, error });
      await logPipelineEvent({
        stage: 'viability-scorer',
        status: 'error',
        message: 'viability scorer worker failed',
        payload: { jobId: job?.id, error: String(error) }
      });
    })();
  });

  return worker;
}
