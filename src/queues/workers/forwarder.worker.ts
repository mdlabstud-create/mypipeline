import { Worker, type Job } from 'bullmq';
import redisClient from '../../config/redis';
import { env } from '../../config/env';
import logger from '../../shared/logger';
import {
  createDefaultForwarderDependencies,
  forwardOrder
} from '../../modules/order-forwarder/forwarder.service';
import { defaultPlaceOrderClient } from '../../modules/order-forwarder/forwarder.client';
import type { IncomingOrder } from '../../shared/types';
import type { ForwardOrderJobData } from '../pipeline.queue';

function isIncomingOrder(value: unknown): value is IncomingOrder {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o['shopifyOrderId'] === 'string' &&
    Array.isArray(o['lineItems'])
  );
}

/**
 * Worker processor (test-friendly).
 */
export async function forwarderProcessor(data: ForwardOrderJobData): Promise<void> {
  if (!isIncomingOrder(data.order)) {
    logger.error('forwarder worker: malformed order payload', { data });
    return;
  }
  const deps = createDefaultForwarderDependencies(
    defaultPlaceOrderClient,
    env.DROPSHIP_FORWARD_DRY_RUN
  );
  const result = await forwardOrder(data.order, deps);
  logger.info('forwarder worker: completed', {
    shopifyOrderId: data.order.shopifyOrderId,
    status: result.status,
    aliexpressOrderId: result.aliexpressOrderId
  });
}

/**
 * Forward-order worker. Consumes the `forward-order` queue and forwards each
 * Shopify order to AliExpress (or dry-runs it).
 */
export function startForwarderWorker(): Worker {
  const worker = new Worker(
    'forward-order',
    async (job: Job<ForwardOrderJobData>) => {
      await forwarderProcessor(job.data);
    },
    { connection: redisClient, concurrency: 1 }
  );

  worker.on('failed', (job, error) => {
    const errObj =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { error };
    logger.error('forwarder worker failed', { jobId: job?.id, ...errObj });
  });

  return worker;
}
