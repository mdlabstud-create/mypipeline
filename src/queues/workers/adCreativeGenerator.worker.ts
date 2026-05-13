import { Worker, type Job } from 'bullmq';
import redisClient from '../../config/redis';
import logger, { logPipelineEvent } from '../../shared/logger';
import { generateAdCreative } from '../../modules/adCreative/adCreative.service';
import type { GenerateAdCreativeJobData } from '../pipeline.queue';

export function startAdCreativeGeneratorWorker(): Worker {
  const worker = new Worker(
    'generate-ad-creative',
    async (job: Job<GenerateAdCreativeJobData>) => {
      const enabled = await redisClient.get('pipeline:ad-creative-generator:enabled');
      const enabledBool = enabled === null ? true : !(enabled === '0' || enabled === 'false');
      if (!enabledBool) {
        logger.warn('ad creative generator kill switch active', { listingId: job.data.listingId });
        return;
      }

      await generateAdCreative(job.data.listingId, job.data.productId);
    },
    { connection: redisClient, concurrency: 2 }
  );

  worker.on('failed', (job: Job<GenerateAdCreativeJobData> | undefined, error: Error) => {
    void (async () => {
      logger.error('ad creative generator worker failed', { jobId: job?.id, error });
      await logPipelineEvent({
        stage: 'ad-creative-generator',
        status: 'error',
        message: 'ad creative generator worker failed',
        payload: { jobId: job?.id, listingId: job?.data.listingId, error: String(error) }
      });
    })();
  });

  return worker;
}
