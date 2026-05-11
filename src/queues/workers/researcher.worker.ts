import { Worker, type Job } from 'bullmq';
import redisClient from '../../config/redis';
import logger, { logPipelineEvent } from '../../shared/logger';
import { researchProduct } from '../../modules/researcher/researcher.service';
import { generateContentQueue } from '../pipeline.queue';
import type { ResearchSuppliersJobData } from '../pipeline.queue';

/**
 * Supplier research worker.
 */
export function startResearcherWorker(): Worker {
  const worker = new Worker(
    'research-suppliers',
    async (job: Job<ResearchSuppliersJobData>) => {
      await researchProduct(job.data.productId);
      await generateContentQueue.add('generate-content', { productId: job.data.productId });
    },
    { connection: redisClient, concurrency: 2 }
  );

  worker.on(
    'failed',
    (job: Job<ResearchSuppliersJobData> | undefined, error: Error) => {
      void (async () => {
        logger.error('researcher worker failed', { jobId: job?.id, error });
        await logPipelineEvent({
          stage: 'researcher-worker',
          status: 'error',
          message: 'researcher worker failed',
          payload: { jobId: job?.id, error: String(error) }
        });
      })();
    }
  );

  return worker;
}