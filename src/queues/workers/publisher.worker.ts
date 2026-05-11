import { Worker, type Job } from 'bullmq';
import redisClient from '../../config/redis';
import logger from '../../shared/logger';
import { publishToShopify } from '../../modules/publisher/shopify.service';
import { getListingById } from '../../modules/publisher/publisher.types';
import { PublisherError } from '../../shared/errors';
import type { PublishProductJobData } from '../pipeline.queue';

/**
 * Publisher processor function (test-friendly).
 */
export async function publisherProcessor(data: PublishProductJobData): Promise<void> {
  const listing = await getListingById(data.listingId);
  if (listing.status !== 'approved') {
    logger.warn('Publisher worker blocked: product not approved', {
      listingId: data.listingId
    });
    return;
  }

  await publishToShopify(
    data.listingId,
    data.shopifyStatus !== undefined ? { shopifyStatus: data.shopifyStatus } : undefined
  );
}

/**
 * Publisher worker. Enforces approval gate (#2).
 */
export function startPublisherWorker(): Worker {
  const worker = new Worker(
    'publish-product',
    async (job: Job<PublishProductJobData>) => {
      await publisherProcessor(job.data);
    },
    { connection: redisClient, concurrency: 1 }
  );

  worker.on('failed', (job, error) => {
    const shopifyResponse =
      error instanceof PublisherError ? (error.shopifyResponse ?? null) : null;
    const errObj =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { error };
    logger.error('publisher worker failed', {
      jobId: job?.id,
      listingId: job?.data.listingId,
      shopifyResponse,
      ...errObj
    });
  });

  return worker;
}