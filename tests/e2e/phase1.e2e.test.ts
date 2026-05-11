import { describe, expect, it } from 'vitest';

const itE2E = process.env.RUN_INTEGRATION === '1' ? it : it.skip;

describe('phase1 e2e', () => {
  itE2E('manual trigger enqueues scraper jobs', async () => {
    const { default: redisClient } = await import('../../src/config/redis');
    const { triggerManually } = await import('../../src/queues/scheduler');

    await redisClient.del('pipeline:enabled');
    await triggerManually();

    const keys = await redisClient.keys('bull:*');
    expect(keys.length).toBeGreaterThan(0);
  });
});

