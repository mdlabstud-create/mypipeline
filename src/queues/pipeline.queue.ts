import { Queue } from 'bullmq';
import redisClient from '../config/redis';

const connection = redisClient;

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 }
};

/**
 * Job payload for TikTok scrape jobs.
 */
export interface TikTokScrapeJobData {
  triggeredAt: string;
}

/**
 * Job payload for Amazon scrape jobs.
 */
export interface AmazonScrapeJobData {
  triggeredAt: string;
}

/**
 * Job payload for merge jobs.
 */
export interface MergeProductsJobData {
  triggeredAt: string;
}

/**
 * Job payload for supplier research jobs.
 */
export interface ResearchSuppliersJobData {
  productId: string;
}

/**
 * Job payload for content generation jobs.
 */
export interface GenerateContentJobData {
  productId: string;
}

/**
 * Job payload for publish jobs.
 */
export interface PublishProductJobData {
  listingId: string;
  /** When set (e.g. from manual approve), overrides default Shopify product status. */
  shopifyStatus?: 'ACTIVE' | 'DRAFT';
}

/**
 * Job payload for forward-order jobs (Shopify -> AliExpress).
 * The full IncomingOrder is passed inline so the worker doesn't have to
 * re-fetch it from Shopify (Shopify webhook bodies are not idempotently
 * replayable without re-auth).
 */
export interface ForwardOrderJobData {
  /**
   * Serialized IncomingOrder. Stored as `unknown` here to avoid a circular
   * import between the queue and the order-forwarder module.
   */
  order: unknown;
}

export const tiktokScrapeQueue = new Queue<TikTokScrapeJobData>('tiktok-scrape', {
  connection,
  defaultJobOptions
});

export const amazonScrapeQueue = new Queue<AmazonScrapeJobData>('amazon-scrape', {
  connection,
  defaultJobOptions
});

export const mergeProductsQueue = new Queue<MergeProductsJobData>('merge-products', {
  connection,
  defaultJobOptions
});

export const researchSuppliersQueue = new Queue<ResearchSuppliersJobData>(
  'research-suppliers',
  {
    connection,
    defaultJobOptions
  }
);

export const generateContentQueue = new Queue<GenerateContentJobData>(
  'generate-content',
  {
    connection,
    defaultJobOptions
  }
);

export const publishProductQueue = new Queue<PublishProductJobData>('publish-product', {
  connection,
  defaultJobOptions
});

export interface ScoreViabilityJobData {
  productId: string;
}

export interface GenerateAdCreativeJobData {
  listingId: string;
  productId: string;
}

export const scoreViabilityQueue = new Queue<ScoreViabilityJobData>('score-viability', {
  connection,
  defaultJobOptions
});

export const adCreativeQueue = new Queue<GenerateAdCreativeJobData>('generate-ad-creative', {
  connection,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 10_000 }
  }
});

export const forwardOrderQueue = new Queue<ForwardOrderJobData>('forward-order', {
  connection,
  defaultJobOptions: {
    ...defaultJobOptions,
    // AE place-order can be slow (10-30s); give the queue more headroom.
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 30_000 }
  }
});