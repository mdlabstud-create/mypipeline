import { z } from 'zod';

/**
 * Chromium expects `browserType.launch({ proxy: { server }})` servers to include a scheme
 * (`http://`, `socks5://`, ...). Webshare dashboards often paste `host:port` only.
 */
function normalizeWebshareProxyServer(raw: string): string {
  const trimmed = raw.trim();
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

/**
 * Convert empty strings to `undefined` so optional env vars can be left blank in `.env`
 * without failing validation (e.g. `FOO=`).
 */
const EmptyToUndefined = z.preprocess((v) => {
  if (typeof v === 'string' && v.trim() === '') return undefined;
  return v;
}, z.any());

const BoolSchema = z.preprocess((v) => {
  if (v === true || v === false) return v;
  if (typeof v === 'string') {
    const lower = v.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return v;
}, z.boolean());

const EnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_URL: z.string().min(1),

  // TikTok Scraping
  APIFY_API_TOKEN: z.string().min(1),
  TIKTOK_HASHTAGS: z.string().optional(),
  TIKTOK_MIN_VIEWS: z.coerce.number().int().positive().optional(),

  // Amazon Scraping
  SCRAPINGDOG_API_KEY: z.string().min(1),
  AMAZON_CATEGORIES: z.string().optional(),
  AMAZON_MAX_BSR: z.coerce.number().int().positive().optional(),

  // Supplier scraping
  /**
   * Proxy for Playwright-based supplier scraping (Alibaba/1688 — currently unused).
   * Optional: only needed if re-enabling Playwright scrapers.
   */
  WEBSHARE_PROXY_SERVER: EmptyToUndefined.pipe(z.string().min(1).optional()),
  WEBSHARE_PROXY_USERNAME: EmptyToUndefined.pipe(z.string().min(1).optional()),
  WEBSHARE_PROXY_PASSWORD: EmptyToUndefined.pipe(z.string().min(1).optional()),

  // AliExpress
  ALIEXPRESS_APP_KEY: z.string().min(1),
  ALIEXPRESS_APP_SECRET: z.string().min(1),
  ALIEXPRESS_TRACKING_ID: z.string().min(1),
  /**
   * Overrides AliExpress title-relevance guard for noisy keywords (0..1).
   * Lower = more permissive matching.
   */
  ALIEXPRESS_MIN_RELEVANCE: z.coerce.number().min(0).max(1).optional(),
  /**
   * Refresh access token when it expires within this many ms (AliExpress recommends ~30 min).
   * Default 24h for backward compatibility with existing deployments.
   */
  ALIEXPRESS_ACCESS_REFRESH_LEAD_MS: z.coerce.number().int().min(60_000).max(168 * 60 * 60 * 1000).optional(),

  /** node-cron expression; empty = disabled. Example: `0 12 * * *` (daily noon UTC). */
  REAUTH_ALERT_CRON: z.string().optional(),
  /** Start reminding this many ms before refresh-token expiry. */
  REAUTH_ALERT_LEAD_MS: z.coerce.number().int().min(60_000).max(365 * 86400_000).optional(),
  /** Minimum gap between successful alert sends (ms). */
  REAUTH_ALERT_COOLDOWN_MS: z.coerce.number().int().min(60_000).max(90 * 86400_000).optional(),
  /** https://core.telegram.org/bots/tutorial — BotFather token */
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  /** Resend recipient (https://resend.com) */
  REAUTH_NOTIFY_EMAIL: EmptyToUndefined.pipe(z.string().email().optional()),
  RESEND_API_KEY: EmptyToUndefined.pipe(z.string().optional()),
  /** Resend `from`, e.g. `Acme <onboarding@resend.dev>` */
  REAUTH_EMAIL_FROM: EmptyToUndefined.pipe(z.string().min(1).optional()),

  // AI Content
  OPENAI_API_KEY: z.string().min(1),
  MARKUP_MULTIPLIER: z.coerce.number().positive().optional(),
  TARGET_MARGIN_PCT: z.coerce.number().positive().optional(),
  MIN_MARGIN_PCT: z.coerce.number().positive().optional(),

  // Images
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),

  // Shopify
  SHOPIFY_STORE_URL: z.string().min(1),
  SHOPIFY_WEBHOOK_SECRET: z.string().min(1),
  // OAuth (for embedded/public app installs)
  SHOPIFY_API_KEY: z.string().min(1).optional(),
  SHOPIFY_API_SECRET: z.string().min(1).optional(),
  PUBLIC_URL: z.string().min(1).optional(),
  // Back-compat (custom app token) - optional once OAuth is enabled
  SHOPIFY_ADMIN_TOKEN: z.string().min(1).optional(),

  // Pipeline Config
  TREND_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).optional(),
  /** How far back trending_products.created_at merge window looks (scraped ideas). Default 1 ≈ legacy 24h behavior. Use ~31 for “this month”. */
  MERGER_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(120).optional(),
  /**
   * Max research-suppliers jobs enqueue per merger run after scoring (0 = no cap).
   * Top trend_score winners are researched first when capped.
   */
  MERGER_MAX_RESEARCH_PER_RUN: z.coerce.number().int().min(0).max(500).optional(),
  /**
   * When true and merger caps research, trending rows that scored above threshold but
   * ranked below the cap are marked rejected for this wave (avoid re-enqueueing forever).
   */
  MERGER_REJECT_NON_CAP_RUN: BoolSchema.optional(),
  /** Minimum images persisted on listings (content step pads from supplier/AE galleries). */
  LISTING_MIN_IMAGES: z.coerce.number().int().min(1).max(20).optional(),
  /**
   * Cap store retail at (amazon_retail_usd * this) when Amazon anchor was captured at scrape time.
   */
  STORE_VS_AMAZON_RATIO: z.coerce.number().min(0.5).max(0.999).optional(),
  SCRAPER_CRON: z.string().optional(),
  AUTO_PUBLISH: BoolSchema.optional(),
  PIPELINE_ENABLED: BoolSchema.optional(),
  DEMO_MODE: BoolSchema.optional(),
  ALLOW_AMAZON_AS_SUPPLIER: BoolSchema.optional(),
  /**
   * When true, never trip the Redis researcher kill switch (use for local/test only).
   */
  DISABLE_RESEARCHER_KILL_SWITCH: BoolSchema.optional(),
  /**
   * Master switch for forwarding Shopify orders to AliExpress.
   * When false (default), orders/create webhooks are still verified and
   * (optionally) Loqate-tagged but no `forward-order` job is enqueued.
   */
  DROPSHIP_AUTO_FORWARD: BoolSchema.optional(),
  /**
   * When true (default), the forwarder runs every step EXCEPT the actual
   * `aliexpress.trade.buy.placeorder` POST. Use this to validate resolution
   * and request payloads in production logs before allowing real charges.
   */
  DROPSHIP_FORWARD_DRY_RUN: BoolSchema.optional(),

  // Currency
  EXCHANGE_RATE_API_KEY: z.string().min(1),

  // Monitoring (Phase 5)
  SENTRY_DSN: z.string().optional(),
  LOQATE_API_KEY: z.string().optional(),

  // Viability Scorer (Task 1)
  /** Minimum composite score to mark a product viable (default: 7.0). */
  VIABILITY_MIN_SCORE: z.coerce.number().min(0).max(10).optional(),
  /** Score floor for marginal (held for review, default: 5.0). */
  VIABILITY_MARGINAL_SCORE: z.coerce.number().min(0).max(10).optional(),
  /** Hard-reject ceiling: competing Shopify stores (default: 50). */
  VIABILITY_COMPETITION_MAX: z.coerce.number().int().min(1).optional(),
  /** Hard-reject floor: estimated margin % (default: 20). */
  VIABILITY_MIN_MARGIN_PCT: z.coerce.number().min(0).max(100).optional(),

  // Ad Creative Generator (Task 3)
  /** OpenAI model for ad creative generation (default: gpt-4o). */
  AD_CREATIVE_MODEL: z.string().optional(),
  /** Max retry attempts for ad creative OpenAI call (default: 3). */
  AD_CREATIVE_MAX_RETRIES: z.coerce.number().int().min(1).max(10).optional(),

  // App
  PORT: z.coerce.number().int().positive().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  /** Bearer token for API auth. When set, all non-health requests must supply it. Unset = open (dev only). */
  API_BEARER_TOKEN: EmptyToUndefined.pipe(z.string().min(8).optional())
});

/**
 * Validated environment variables for the pipeline.
 *
 * This is the only module allowed to access `process.env`.
 */
export const env = (() => {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  const webshareProxyServer = parsed.data.WEBSHARE_PROXY_SERVER
    ? normalizeWebshareProxyServer(parsed.data.WEBSHARE_PROXY_SERVER)
    : undefined;

  return {
    ...parsed.data,
    WEBSHARE_PROXY_SERVER: webshareProxyServer ?? '',
    TIKTOK_HASHTAGS:
      parsed.data.TIKTOK_HASHTAGS ??
      'TikTokMadeMeBuyIt,viral,trending,AmazonFinds',
    // Default aligned with typical hashtag results (Apify samples often ~10k–100k views).
    TIKTOK_MIN_VIEWS: parsed.data.TIKTOK_MIN_VIEWS ?? 10000,
    AMAZON_CATEGORIES:
      parsed.data.AMAZON_CATEGORIES ??
      'Electronics,HomeAndKitchen,ToysAndGames,BeautyPersonalCare',
    AMAZON_MAX_BSR: parsed.data.AMAZON_MAX_BSR ?? 5000,
    TREND_SCORE_THRESHOLD: parsed.data.TREND_SCORE_THRESHOLD ?? 0.4,
    MERGER_LOOKBACK_DAYS: parsed.data.MERGER_LOOKBACK_DAYS ?? 1,
    MERGER_MAX_RESEARCH_PER_RUN: parsed.data.MERGER_MAX_RESEARCH_PER_RUN ?? 0,
    MERGER_REJECT_NON_CAP_RUN: parsed.data.MERGER_REJECT_NON_CAP_RUN ?? false,
    LISTING_MIN_IMAGES: parsed.data.LISTING_MIN_IMAGES ?? 5,
    STORE_VS_AMAZON_RATIO: parsed.data.STORE_VS_AMAZON_RATIO ?? 0.92,
    SCRAPER_CRON: parsed.data.SCRAPER_CRON ?? '0 6 * * *',
    MARKUP_MULTIPLIER: parsed.data.MARKUP_MULTIPLIER ?? 2.8,
    TARGET_MARGIN_PCT: parsed.data.TARGET_MARGIN_PCT ?? 40,
    MIN_MARGIN_PCT: parsed.data.MIN_MARGIN_PCT ?? 10,
    ALIEXPRESS_MIN_RELEVANCE: parsed.data.ALIEXPRESS_MIN_RELEVANCE ?? undefined,
    ALIEXPRESS_ACCESS_REFRESH_LEAD_MS:
      parsed.data.ALIEXPRESS_ACCESS_REFRESH_LEAD_MS ?? 60 * 60 * 1000,
    REAUTH_ALERT_CRON: parsed.data.REAUTH_ALERT_CRON?.trim() ?? '',
    REAUTH_ALERT_LEAD_MS:
      parsed.data.REAUTH_ALERT_LEAD_MS ?? 7 * 24 * 60 * 60 * 1000,
    REAUTH_ALERT_COOLDOWN_MS:
      parsed.data.REAUTH_ALERT_COOLDOWN_MS ?? 72 * 60 * 60 * 1000,
    TELEGRAM_BOT_TOKEN: parsed.data.TELEGRAM_BOT_TOKEN ?? undefined,
    TELEGRAM_CHAT_ID: parsed.data.TELEGRAM_CHAT_ID ?? undefined,
    REAUTH_NOTIFY_EMAIL: parsed.data.REAUTH_NOTIFY_EMAIL ?? undefined,
    RESEND_API_KEY: parsed.data.RESEND_API_KEY ?? undefined,
    REAUTH_EMAIL_FROM: parsed.data.REAUTH_EMAIL_FROM ?? undefined,
    AUTO_PUBLISH: parsed.data.AUTO_PUBLISH ?? false,
    PIPELINE_ENABLED: parsed.data.PIPELINE_ENABLED ?? true,
    DEMO_MODE: parsed.data.DEMO_MODE ?? false,
    ALLOW_AMAZON_AS_SUPPLIER: parsed.data.ALLOW_AMAZON_AS_SUPPLIER ?? false,
    DISABLE_RESEARCHER_KILL_SWITCH: parsed.data.DISABLE_RESEARCHER_KILL_SWITCH ?? false,
    DROPSHIP_AUTO_FORWARD: parsed.data.DROPSHIP_AUTO_FORWARD ?? false,
    DROPSHIP_FORWARD_DRY_RUN: parsed.data.DROPSHIP_FORWARD_DRY_RUN ?? true,
    VIABILITY_MIN_SCORE: parsed.data.VIABILITY_MIN_SCORE ?? 7.0,
    VIABILITY_MARGINAL_SCORE: parsed.data.VIABILITY_MARGINAL_SCORE ?? 5.0,
    VIABILITY_COMPETITION_MAX: parsed.data.VIABILITY_COMPETITION_MAX ?? 50,
    VIABILITY_MIN_MARGIN_PCT: parsed.data.VIABILITY_MIN_MARGIN_PCT ?? 20,
    AD_CREATIVE_MODEL: parsed.data.AD_CREATIVE_MODEL ?? 'gpt-4o',
    AD_CREATIVE_MAX_RETRIES: parsed.data.AD_CREATIVE_MAX_RETRIES ?? 3,
    PORT: parsed.data.PORT ?? 3000,
    NODE_ENV: parsed.data.NODE_ENV ?? 'development',
    API_BEARER_TOKEN: parsed.data.API_BEARER_TOKEN ?? undefined
  };
})();

/**
 * Parsed TikTok hashtags list.
 */
export const tiktokHashtags = env.TIKTOK_HASHTAGS.split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/**
 * Parsed Amazon category list.
 */
export const amazonCategories = env.AMAZON_CATEGORIES.split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);