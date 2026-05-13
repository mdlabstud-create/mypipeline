import OpenAI from 'openai';
import { z } from 'zod';
import { query } from '../../config/db';
import { env } from '../../config/env';
import { logPipelineEvent } from '../../shared/logger';
import logger from '../../shared/logger';

// ---------- validation schema ----------

const AngleSchema = z.object({
  id: z.number(),
  name: z.string(),
  strategy: z.string(),
  target_emotion: z.string()
});

const HookSchema = z.object({
  angle_id: z.number(),
  hook_text: z.string(),
  platform: z.enum(['tiktok', 'facebook', 'instagram']),
  hook_type: z.enum(['question', 'statement', 'shock', 'story', 'before_after'])
});

const ImageAdPromptSchema = z.object({
  angle_id: z.number(),
  prompt: z.string(),
  layout: z.enum(['single_product', 'lifestyle', 'before_after', 'comparison', 'ugc_style']),
  headline: z.string(),
  subtext: z.string()
});

const VideoScriptSchema = z.object({
  angle_id: z.number(),
  hook: z.string(),
  problem: z.string(),
  solution: z.string(),
  demo_direction: z.string(),
  cta: z.string(),
  total_duration_seconds: z.number()
});

const HashtagsSchema = z.object({
  tiktok: z.array(z.string()),
  instagram: z.array(z.string()),
  facebook: z.array(z.string())
});

const PlatformCopiesSchema = z.object({
  facebook: z.object({
    primary_text: z.string(),
    headline: z.string(),
    description: z.string()
  }),
  instagram: z.object({
    caption: z.string(),
    story_text: z.string()
  }),
  tiktok: z.object({
    caption: z.string(),
    description: z.string()
  })
});

const AdCreativeOutputSchema = z.object({
  angles: z.array(AngleSchema).min(1),
  hooks: z.array(HookSchema).min(1),
  image_ad_prompts: z.array(ImageAdPromptSchema).min(1),
  video_scripts: z.array(VideoScriptSchema).min(1),
  hashtags: HashtagsSchema,
  platform_copies: PlatformCopiesSchema
});

type AdCreativeOutput = z.infer<typeof AdCreativeOutputSchema>;

// ---------- JSON cleaner (same pattern as content.service.ts) ----------

function cleanGptJson(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    const firstNewline = s.indexOf('\n');
    if (firstNewline !== -1) s = s.slice(firstNewline + 1);
    const fenceIdx = s.lastIndexOf('```');
    if (fenceIdx !== -1) s = s.slice(0, fenceIdx);
    s = s.trim();
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return s.slice(start, end + 1).trim();
  }
  return s;
}

function parseAdCreativeJson(raw: string): AdCreativeOutput {
  const cleaned = cleanGptJson(raw);
  const parsed = JSON.parse(cleaned) as unknown;
  return AdCreativeOutputSchema.parse(parsed);
}

// ---------- bullet extractor ----------

function extractBullets(description: string): string {
  const sentences = description
    .split(/[.!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15)
    .slice(0, 4);
  return sentences.join('; ');
}

// ---------- main generator ----------

export async function generateAdCreative(listingId: string, productId: string): Promise<void> {
  const listingRows = await query<{
    title: string;
    description: string;
    retail_usd: number;
  }>(
    'SELECT title, description, retail_usd::float8 AS retail_usd FROM product_listings WHERE id = $1 LIMIT 1',
    [listingId]
  );
  const listing = listingRows[0];
  if (!listing) {
    logger.warn('adCreative: listing not found', { listingId });
    return;
  }

  const productRows = await query<{ keyword: string }>(
    'SELECT keyword FROM trending_products WHERE id = $1 LIMIT 1',
    [productId]
  );
  const product = productRows[0];

  const supplierRows = await query<{ ships_from_country: string | null }>(
    'SELECT ships_from_country FROM suppliers WHERE product_id = $1 AND rank = 1 LIMIT 1',
    [productId]
  );
  const shipsFrom = supplierRows[0]?.ships_from_country ?? 'Unknown';

  const bullets = extractBullets(listing.description);

  const systemPrompt =
    'You are a world-class performance marketing creative director specialising in ' +
    'dropshipping product ads for Meta (Facebook/Instagram) and TikTok. You create ' +
    'ad creatives that stop the scroll, trigger emotional responses, and drive ' +
    'immediate purchase intent. You never use generic language. Every hook is ' +
    'specific, visceral, and benefit-led. Output valid JSON only — no markdown, no commentary.';

  const userPrompt = `Product: ${listing.title}
Category: ${product?.keyword ?? 'general'}
Price: $${listing.retail_usd.toFixed(2)}
Key benefits from description: ${bullets}
Supplier ships from: ${shipsFrom}
Target platforms: Facebook, Instagram, TikTok

Generate the following as a single valid JSON object (no markdown, no commentary):

{
  "angles": [
    { "id": 1, "name": "string", "strategy": "string", "target_emotion": "string" },
    { "id": 2, "name": "string", "strategy": "string", "target_emotion": "string" },
    { "id": 3, "name": "string", "strategy": "string", "target_emotion": "string" },
    { "id": 4, "name": "string", "strategy": "string", "target_emotion": "string" }
  ],
  "hooks": [
    { "angle_id": 1, "hook_text": "string (under 12 words)", "platform": "tiktok|facebook|instagram", "hook_type": "question|statement|shock|story|before_after" }
    // 5 hooks per angle = 20 total
  ],
  "image_ad_prompts": [
    { "angle_id": 1, "prompt": "string (full Midjourney/DALLE prompt)", "layout": "single_product|lifestyle|before_after|comparison|ugc_style", "headline": "string (4-6 words)", "subtext": "string (one sentence)" }
    // 4 prompts, one per angle
  ],
  "video_scripts": [
    { "angle_id": 1, "hook": "string", "problem": "string", "solution": "string", "demo_direction": "string", "cta": "string", "total_duration_seconds": 30 }
    // 4 scripts, one per angle
  ],
  "hashtags": {
    "tiktok": ["array of 8-10 hashtags without #"],
    "instagram": ["array of 15-20 hashtags without #"],
    "facebook": ["array of 5-8 hashtags without #"]
  },
  "platform_copies": {
    "facebook": { "primary_text": "string (125 chars max)", "headline": "string (40 chars max)", "description": "string (30 chars max)" },
    "instagram": { "caption": "string (150 chars max with emoji)", "story_text": "string (30 chars max)" },
    "tiktok": { "caption": "string (100 chars max)", "description": "string (150 chars max)" }
  }
}`;

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const maxRetries = env.AD_CREATIVE_MAX_RETRIES;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = await client.chat.completions.create({
        model: env.AD_CREATIVE_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.8
      });

      const raw = resp.choices[0]?.message?.content ?? '';
      const parsed: AdCreativeOutput = parseAdCreativeJson(raw);

      await query(
        `INSERT INTO ad_creatives
           (listing_id, product_id, angles, hooks, image_ad_prompts, video_scripts, hashtags, platform_copies, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')`,
        [
          listingId,
          productId,
          JSON.stringify(parsed.angles),
          JSON.stringify(parsed.hooks),
          JSON.stringify(parsed.image_ad_prompts),
          JSON.stringify(parsed.video_scripts),
          JSON.stringify(parsed.hashtags),
          JSON.stringify(parsed.platform_copies)
        ]
      );

      await logPipelineEvent({
        stage: 'ad-creative-generator',
        status: 'ok',
        message: 'ad creatives generated',
        productId,
        payload: { listingId, angles: parsed.angles.length, hooks: parsed.hooks.length }
      });
      return;
    } catch (err: unknown) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 2000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  await logPipelineEvent({
    stage: 'ad-creative-generator',
    status: 'error',
    message: 'failed after retries',
    productId,
    payload: { listingId, error: String(lastError) }
  });
}
