import { mergeProductsQueue } from '../src/queues/pipeline.queue';

void (async () => {
  const job = await mergeProductsQueue.add('merge-products', { triggeredAt: new Date().toISOString() });
  console.log('merger enqueued, jobId:', job.id);
  process.exit(0);
})();
