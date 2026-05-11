import type { Worker } from 'bullmq';
import { startAmazonWorker } from './amazon.worker';
import { startContentWorker } from './content.worker';
import { startForwarderWorker } from './forwarder.worker';
import { startMergerWorker } from './merger.worker';
import { startPublisherWorker } from './publisher.worker';
import { startResearcherWorker } from './researcher.worker';
import { startTikTokWorker } from './tiktok.worker';

/**
 * Starts all BullMQ workers for the pipeline.
 */
export function startAllWorkers(): Worker[] {
  return [
    startTikTokWorker(),
    startAmazonWorker(),
    startMergerWorker(),
    startResearcherWorker(),
    startContentWorker(),
    startPublisherWorker(),
    startForwarderWorker()
  ];
}

