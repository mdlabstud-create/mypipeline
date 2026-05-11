/**
 * Error thrown when a scraping stage fails.
 */
export class ScraperError extends Error {
  public readonly source: string;
  public readonly retryable: boolean;

  public constructor(message: string, source: string, retryable: boolean) {
    super(message);
    this.name = 'ScraperError';
    this.source = source;
    this.retryable = retryable;
  }
}

/**
 * Error thrown when supplier research fails.
 */
export class SupplierError extends Error {
  public readonly platform: string;
  public readonly productId: string;

  public constructor(message: string, platform: string, productId: string) {
    super(message);
    this.name = 'SupplierError';
    this.platform = platform;
    this.productId = productId;
  }
}

/**
 * Error thrown when GPT content generation fails validation.
 */
export class ContentGenerationError extends Error {
  public readonly productId: string;
  public readonly rawResponse?: unknown;

  public constructor(message: string, productId: string, rawResponse?: unknown) {
    super(message);
    this.name = 'ContentGenerationError';
    this.productId = productId;
    this.rawResponse = rawResponse;
  }
}

/**
 * Error thrown when publishing to Shopify fails.
 */
export class PublisherError extends Error {
  public readonly productId: string;
  public readonly shopifyResponse?: unknown;

  public constructor(message: string, productId: string, shopifyResponse?: unknown) {
    super(message);
    this.name = 'PublisherError';
    this.productId = productId;
    this.shopifyResponse = shopifyResponse;
  }
}

/**
 * Error thrown for input/schema validation issues.
 */
export class ValidationError extends Error {
  public readonly field: string;
  public readonly value: unknown;

  public constructor(message: string, field: string, value: unknown) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}

/**
 * Error thrown when an external service rate limits requests.
 */
export class RateLimitError extends Error {
  public readonly service: string;
  public readonly retryAfterMs?: number;

  public constructor(message: string, service: string, retryAfterMs?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.service = service;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}