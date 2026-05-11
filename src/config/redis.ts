import Redis from 'ioredis';
import logger from '../shared/logger';
import { env } from './env';

/**
 * Shared Redis client (BullMQ + kill switches + caching).
 */
const redisClient = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  // BullMQ requires this to avoid stalled commands on connection issues.
  maxRetriesPerRequest: null,
  retryStrategy: (times: number) => {
    if (times > 10) return null;
    return Math.min(50 * 2 ** times, 30_000);
  }
});

redisClient.on('error', (error: Error) => {
  logger.error('redis error', { error });
});

export default redisClient;