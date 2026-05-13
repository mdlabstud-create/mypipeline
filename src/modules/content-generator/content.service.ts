import OpenAI from 'openai';
import { z } from 'zod';
import axios from 'axios';
import { env } from '../../config/env';
import { query } from '../../config/db';
import { logPipelineEvent } from '../../shared/logger';
import { ContentGenerationError } from '../../shared/errors';
import type { GPTListingOutput } from '../../shared/types';
import { handleImages } from './images';
import { calculatePricing } from './pricing';
import logger from '../../shared/logger';
import {
  extractAliExpressProductIdFromUrl,
  getAliExpressProductDetails
} from '../researcher/aliexpress';

const GPTOutputSchema: z.ZodType<GPTListingOutput> = z.object({
  title: z.string().max(80),
  // Prompt asks for ~150–200 words; a 500-char cap rejects valid GPT output.
  description: z.string().min(100).max(4000),
  bullet_points: z.array(z.string()).length(5),
  tags: z.array(z.string()).min(5).max(10),
  seo_title: z.string().max(70),
  seo_description: z.string().max(160)
});

/**
 * Parses and validates GPT JSON-only response.
 */
export function parseGptJson(raw: string): GPTListingOutput {
  const cleaned = cleanGptJson(raw);
  const parsed = JSON.parse(cleaned) as unknown;
  return GPTOutputSchema.parse(parsed);
}

function cleanGptJson(raw: string): string {
  let s = raw.trim();

  // Remove common Markdown code fences: ```json ... ``` or ``` ... ```
  if (s.startsWith('```')) {
    // drop first fence line
    const firstNewline = s.indexOf('\n');
    if (firstNewline !== -1) s = s.slice(firstNewline + 1);
    // drop trailing fence
    const fenceIdx = s.lastIndexOf('```');
    if (fenceIdx !== -1) s = s.slice(0, fenceIdx);
    s = s.trim();
  }

  // If model still included extra text, try extracting the first JSON object.
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = s.slice(start, end + 1).trim();
    return candidate;
  }

  return s;
}

function uniqHttps(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    let u = raw.trim();
    if (!u.startsWith('http')) continue;
    if (u.startsWith('http://')) u = `https://${u.slice(7)}`;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/**
 * Loads extra gallery URLs (AliExpress DS API when possible), then pads with the
 * hero image until `min` is reached so storefronts stay consistent with pipeline policy.
 */
export async function ensureMinListingImages(params: {
  platform: string;
  supplierUrl: string;
  baseImages: string[];
  min: number;
  amazonAsin?: string | null;
}): Promise<string[]> {
  const { platform, supplierUrl, baseImages, min, amazonAsin } = params;
  let urls = uniqHttps(baseImages);

  if (urls.length >= min) return urls.slice(0, 12);

  if (platform === 'amazon' && amazonAsin) {
    try {
      const res = await axios.get('https://api.scrapingdog.com/amazon/product', {
        params: {
          api_key: env.SCRAPINGDOG_API_KEY,
          domain: 'com',
          asin: amazonAsin,
          country: 'us'
        },
        timeout: 30_000
      });
      const data: unknown = res.data;
      const imagesRaw =
        typeof data === 'object' && data !== null && 'images' in data
          ? (data as { images?: unknown }).images
          : undefined;
      const imgs = Array.isArray(imagesRaw) ? imagesRaw : [];
      const fromAmz = imgs.filter((x): x is string => typeof x === 'string' && /^https:\/\//i.test(x));
      const processed = await handleImages(fromAmz);
      urls = uniqHttps([...urls, ...processed]);
    } catch (e: unknown) {
      logger.warn('content: amazon product images fetch failed', {
        detail: e instanceof Error ? e.message : String(e),
        amazonAsin
      });
    }
  }

  if (platform === 'aliexpress') {
    const pid = extractAliExpressProductIdFromUrl(supplierUrl);
    if (pid) {
      try {
        const moreRaw = await getAliExpressProductDetails(pid);
        const moreProcessed = await handleImages(moreRaw);
        urls = uniqHttps([...urls, ...moreProcessed]);
      } catch (e: unknown) {
        logger.warn('content: aliexpress gallery fetch failed', {
          detail: e instanceof Error ? e.message : String(e),
          pid
        });
      }
    }
  }

  if (urls.length >= min) return urls.slice(0, 12);
  if (urls.length === 0) return [];
  const hero = urls[0]!;
  while (urls.length < min) urls.push(hero);
  return urls.slice(0, 12);
}

/**
 * Generates a product listing for a product and returns the new listing id.
 */
export async function generateContent(productId: string): Promise<string | null> {
  // Load product + top supplier (rank=1)
  const productRows = await query<{
    keyword: string;
    trend_score: number;
    amazon_asin: string | null;
    amazon_retail_usd: number | null;
    tiktok_retail_usd: number | null;
  }>(
    `SELECT keyword, trend_score, amazon_asin,
            amazon_retail_usd::float8 AS amazon_retail_usd,
            tiktok_retail_usd::float8 AS tiktok_retail_usd
     FROM trending_products WHERE id = $1 LIMIT 1`,
    [productId]
  );
  const product = productRows[0];
  if (!product) return null;

  const supplierRows = await query<{
    id: string;
    platform: string;
    supplier_url: string;
    product_title: string | null;
    price_usd: number;
    shipping_days: number | null;
    sla_status: string | null;
    rating: number | null;
    review_count: number | null;
    images: unknown;
  }>('SELECT * FROM suppliers WHERE product_id = $1 AND rank = 1 LIMIT 1', [productId]);
  const supplier = supplierRows[0];
  if (!supplier) return null;

  // SLA guard: top-ranked supplier must not be disqualified
  if (supplier.sla_status === 'disqualified') {
    await query(`UPDATE trending_products SET status = 'error' WHERE id = $1`, [productId]);
    await logPipelineEvent({
      stage: 'content-generator',
      status: 'error',
      message: 'skipped: top supplier sla_status is disqualified',
      productId,
      payload: { supplierId: supplier.id, slaStatus: supplier.sla_status }
    });
    return null;
  }

  const blocked = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM product_listings
     WHERE product_id = $1
       AND status IN ('pending_review', 'approved', 'published')`,
    [productId]
  );
  if (Number(blocked[0]?.n ?? 0) > 0) {
    logger.warn('generateContent skipped: listing already exists for product', { productId });
    return null;
  }

  const amazonRef =
    product.amazon_retail_usd != null && Number.isFinite(product.amazon_retail_usd)
      ? product.amazon_retail_usd
      : null;

  const tiktokRef =
    product.tiktok_retail_usd != null && Number.isFinite(product.tiktok_retail_usd)
      ? product.tiktok_retail_usd
      : null;

  const supplierImages = Array.isArray(supplier.images)
    ? (supplier.images as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  const hydrated = await handleImages(supplierImages);
  const imageUrls = await ensureMinListingImages({
    platform: supplier.platform,
    supplierUrl: supplier.supplier_url,
    baseImages: hydrated,
    min: env.LISTING_MIN_IMAGES,
    amazonAsin: product.amazon_asin
  });

  if (imageUrls.length < env.LISTING_MIN_IMAGES) {
    await query('UPDATE trending_products SET status = $2 WHERE id = $1', [productId, 'error']);
    await logPipelineEvent({
      stage: 'content-generator',
      status: 'error',
      message: `insufficient_images_need_${env.LISTING_MIN_IMAGES}`,
      productId,
      payload: { count: imageUrls.length }
    });
    return null;
  }

  const uniq = uniqHttps(imageUrls);
  const padded: string[] = [...uniq];
  if (uniq.length > 0) {
    let i = 0;
    while (padded.length < env.LISTING_MIN_IMAGES) {
      padded.push(uniq[i % uniq.length]!);
      i += 1;
    }
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const system =
    'You are an expert Shopify product copywriter specializing in dropshipping products. You write compelling, SEO-optimized product listings that convert browsers into buyers. You always output valid JSON only — no markdown, no explanation, no extra text. Never mention the supplier, AliExpress, Alibaba, or China. Never make false claims. Write in American English.';

  // Use the actual sourced product title so GPT describes the real item (not the garbled TikTok keyword).
  const productName = supplier.product_title?.trim() || product.keyword;

  const user = `Create a complete Shopify product listing for this product.

Product name: ${productName}
Supplier sourcing price (cost proxy): $${supplier.price_usd}
${amazonRef != null ? `Amazon reference price when scraped: $${amazonRef.toFixed(2)} — do NOT mention Amazon in copy or claim parity.\n` : ''}
Shipping time: ${supplier.shipping_days ?? 'unknown'} days
Supplier rating: ${supplier.rating ?? 'unknown'}/5 based on ${supplier.review_count ?? 0} reviews
Platform: ${supplier.platform}

Output a JSON object with EXACTLY these fields:
{
  title: string (max 80 characters, compelling, SEO-friendly),
  description: string (150-200 words, 2 paragraphs, benefits-focused,
                      no bullet points in this field),
  bullet_points: string[] (exactly 5 items, each 10-20 words,
                           start each with a strong action word),
  tags: string[] (8-10 lowercase SEO keywords),
  seo_title: string (max 70 characters),
  seo_description: string (max 160 characters)
}
Output JSON only. No other text.`;

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });

  const content = resp.choices[0]?.message?.content;
  if (!content) {
    throw new ContentGenerationError('Empty OpenAI response', productId);
  }

  let parsed: GPTListingOutput;
  try {
    parsed = parseGptJson(content);
  } catch (error: unknown) {
    await query('UPDATE trending_products SET status = $2 WHERE id = $1', [
      productId,
      'error'
    ]);
    throw new ContentGenerationError('Invalid GPT JSON', productId, { error, content });
  }

  let pricing: ReturnType<typeof calculatePricing>;
  try {
    pricing = calculatePricing(supplier.price_usd, {
      markupMultiplier: env.MARKUP_MULTIPLIER,
      minMarginPct: env.MIN_MARGIN_PCT,
      amazonRetailAnchorUsd: amazonRef,
      tiktokRetailAnchorUsd: tiktokRef,
      storeVsAmazonRatio: env.STORE_VS_AMAZON_RATIO
    });
  } catch (e: unknown) {
    logger.warn('generateContent skipped: pricing rejected', {
      productId,
      detail: e instanceof Error ? e.message : String(e)
    });
    await query('UPDATE trending_products SET status = $2 WHERE id = $1', [productId, 'error']);
    return null;
  }

  let listingId: string | null = null;

  try {
    const listingRows = await query<{ id: string }>(
      `INSERT INTO product_listings
        (product_id, supplier_id, title, description, bullet_points, tags, seo_title, seo_description, images,
         cost_usd, retail_usd, margin_pct, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending_review')
       RETURNING id`,
      [
        productId,
        supplier.id,
        parsed.title,
        parsed.description,
        JSON.stringify(parsed.bullet_points),
        parsed.tags,
        parsed.seo_title,
        parsed.seo_description,
        JSON.stringify(padded.slice(0, 12)),
        pricing.costUsd,
        pricing.retailUsd,
        pricing.marginPct
      ]
    );

    listingId = listingRows[0]?.id ?? null;
  } catch (error: unknown) {
    const codeValue =
      typeof error === 'object' && error !== null
        ? (error as Record<string, unknown>)['code']
        : undefined;
    const code =
      typeof codeValue === 'string' || typeof codeValue === 'number' ? String(codeValue) : '';
    if (code === '23505') {
      logger.warn('generateContent skipped: concurrent or duplicate listing (unique constraint)', {
        productId
      });
      return null;
    }
    throw error;
  }

  await query('UPDATE trending_products SET status = $2 WHERE id = $1', [
    productId,
    'pending_review'
  ]);

  await logPipelineEvent({
    stage: 'content-generator',
    status: 'ok',
    message: 'listing generated',
    productId,
    payload: { listingId }
  });

  return listingId;
}