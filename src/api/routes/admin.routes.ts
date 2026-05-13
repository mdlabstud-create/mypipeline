import { Router } from 'express';
import { z } from 'zod';
import redisClient from '../../config/redis';
import { env } from '../../config/env';
import { triggerManually } from '../../queues/scheduler';
import { logPipelineEvent } from '../../shared/logger';
import { seedDemoData } from '../../modules/demo/demo.seed';
import { query } from '../../config/db';

export const adminRouter = Router();

adminRouter.post('/trigger', async (_req, res, next) => {
  try {
    await triggerManually();
    res.status(200).json({ ok: true });
  } catch (e: unknown) {
    next(e);
  }
});

const DemoSeedSchema = z.object({
  count: z.number().int().min(1).max(10).optional()
});

adminRouter.post('/demo/seed', async (req, res, next) => {
  try {
    if (!env.DEMO_MODE) {
      res.status(403).json({ error: 'demo_mode_disabled' });
      return;
    }

    const parsed = DemoSeedSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const out = await seedDemoData(
      parsed.data.count !== undefined ? { count: parsed.data.count } : {}
    );
    res.status(200).json({ ok: true, ...out });
  } catch (e: unknown) {
    next(e);
  }
});

const ToggleSchema = z.object({
  enabled: z.boolean()
});

// ---------- Viability endpoint ----------

adminRouter.get('/viability', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query['page'] ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query['limit'] ?? 20)));
    const offset = (page - 1) * limit;
    const statusFilter = typeof req.query['status'] === 'string' ? req.query['status'] : null;

    const whereClause = statusFilter ? `WHERE viability_status = $3` : '';
    const params: (string | number)[] = statusFilter
      ? [limit, offset, statusFilter]
      : [limit, offset];

    const rows = await query<{
      id: string;
      keyword: string;
      source: string;
      viability_status: string;
      viability_score: number | null;
      viability_breakdown: unknown;
      viability_checked_at: string | null;
      amazon_retail_usd: number | null;
      tiktok_score: number | null;
      created_at: string;
    }>(
      `SELECT id, keyword, source, viability_status, viability_score::float8 AS viability_score,
              viability_breakdown, viability_checked_at,
              amazon_retail_usd::float8 AS amazon_retail_usd,
              tiktok_score::float8 AS tiktok_score, created_at
       FROM trending_products ${whereClause}
       ORDER BY viability_checked_at DESC NULLS LAST, created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    // Counts by status for dashboard summary
    const counts = await query<{ viability_status: string; n: string }>(
      `SELECT viability_status, COUNT(*)::text AS n FROM trending_products GROUP BY viability_status`
    );

    // SLA issues (products where all suppliers were disqualified)
    const slaIssues = await query<{ id: string; keyword: string }>(
      `SELECT DISTINCT tp.id, tp.keyword
       FROM trending_products tp
       WHERE tp.status = 'error'
         AND EXISTS (
           SELECT 1 FROM suppliers s WHERE s.product_id = tp.id AND s.sla_status = 'disqualified'
         )
         AND NOT EXISTS (
           SELECT 1 FROM suppliers s WHERE s.product_id = tp.id AND s.sla_status NOT IN ('disqualified', 'unknown')
         )
       ORDER BY tp.keyword LIMIT 50`
    );

    res.json({
      products: rows,
      summary: Object.fromEntries(counts.map((c) => [c.viability_status, Number(c.n)])),
      slaIssues,
      pagination: { page, limit }
    });
  } catch (e: unknown) {
    next(e);
  }
});

// ---------- Ad Creatives endpoints ----------

adminRouter.get('/ad-creatives', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query['page'] ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query['limit'] ?? 20)));
    const offset = (page - 1) * limit;
    const statusFilter = typeof req.query['status'] === 'string' ? req.query['status'] : null;

    const whereClause = statusFilter ? `WHERE ac.status = $3` : '';
    const params: (string | number)[] = statusFilter
      ? [limit, offset, statusFilter]
      : [limit, offset];

    const rows = await query<{
      id: string;
      listing_id: string;
      product_id: string;
      status: string;
      generated_at: string;
      listing_title: string | null;
      retail_usd: number | null;
    }>(
      `SELECT ac.id, ac.listing_id, ac.product_id, ac.status, ac.generated_at,
              pl.title AS listing_title, pl.retail_usd::float8 AS retail_usd
       FROM ad_creatives ac
       LEFT JOIN product_listings pl ON pl.id = ac.listing_id
       ${whereClause}
       ORDER BY ac.generated_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    res.json({ creatives: rows, pagination: { page, limit } });
  } catch (e: unknown) {
    next(e);
  }
});

adminRouter.get('/ad-creatives/:id', async (req, res, next) => {
  try {
    const rows = await query<{
      id: string;
      listing_id: string;
      product_id: string;
      angles: unknown;
      hooks: unknown;
      image_ad_prompts: unknown;
      video_scripts: unknown;
      hashtags: unknown;
      platform_copies: unknown;
      generated_at: string;
      status: string;
    }>(
      `SELECT id, listing_id, product_id, angles, hooks, image_ad_prompts,
              video_scripts, hashtags, platform_copies, generated_at, status
       FROM ad_creatives WHERE id = $1 LIMIT 1`,
      [req.params['id']]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(rows[0]);
  } catch (e: unknown) {
    next(e);
  }
});

const AdCreativeStatusSchema = z.object({
  status: z.enum(['draft', 'approved', 'used'])
});

adminRouter.patch('/ad-creatives/:id/status', async (req, res, next) => {
  try {
    const parsed = AdCreativeStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten().fieldErrors });
      return;
    }
    const updated = await query<{ id: string }>(
      `UPDATE ad_creatives SET status = $2 WHERE id = $1 RETURNING id`,
      [req.params['id'], parsed.data.status]
    );
    if (!updated[0]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ ok: true, id: updated[0].id, status: parsed.data.status });
  } catch (e: unknown) {
    next(e);
  }
});

adminRouter.get('/ad-creatives/:id/export', async (req, res, next) => {
  try {
    const rows = await query<{
      angles: unknown;
      hooks: unknown;
      image_ad_prompts: unknown;
      video_scripts: unknown;
      hashtags: unknown;
      platform_copies: unknown;
      listing_title: string | null;
    }>(
      `SELECT ac.angles, ac.hooks, ac.image_ad_prompts, ac.video_scripts,
              ac.hashtags, ac.platform_copies, pl.title AS listing_title
       FROM ad_creatives ac
       LEFT JOIN product_listings pl ON pl.id = ac.listing_id
       WHERE ac.id = $1 LIMIT 1`,
      [req.params['id']]
    );
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const angles = Array.isArray(row.angles) ? row.angles : [];
    const hooks = Array.isArray(row.hooks) ? row.hooks : [];
    const scripts = Array.isArray(row.video_scripts) ? row.video_scripts : [];
    const prompts = Array.isArray(row.image_ad_prompts) ? row.image_ad_prompts : [];
    const hashtags = (row.hashtags as Record<string, string[]>) ?? {};
    const copies = (row.platform_copies as Record<string, Record<string, string>>) ?? {};

    const lines: string[] = [
      `=== AD CREATIVES EXPORT: ${row.listing_title ?? 'Product'} ===`,
      ''
    ];

    for (const angle of angles as Array<Record<string, unknown>>) {
      lines.push(`--- ANGLE ${angle['id']}: ${angle['name']} ---`);
      lines.push(`Strategy: ${angle['strategy']}`);
      lines.push(`Emotion: ${angle['target_emotion']}`);
      lines.push('');

      const angleHooks = (hooks as Array<Record<string, unknown>>).filter((h) => h['angle_id'] === angle['id']);
      if (angleHooks.length > 0) {
        lines.push('HOOKS:');
        for (const h of angleHooks) {
          lines.push(`  [${h['platform']} / ${h['hook_type']}] ${h['hook_text']}`);
        }
        lines.push('');
      }

      const script = (scripts as Array<Record<string, unknown>>).find((s) => s['angle_id'] === angle['id']);
      if (script) {
        lines.push(`VIDEO SCRIPT (${script['total_duration_seconds']}s):`);
        lines.push(`  Hook: ${script['hook']}`);
        lines.push(`  Problem: ${script['problem']}`);
        lines.push(`  Solution: ${script['solution']}`);
        lines.push(`  Demo: ${script['demo_direction']}`);
        lines.push(`  CTA: ${script['cta']}`);
        lines.push('');
      }

      const prompt = (prompts as Array<Record<string, unknown>>).find((p) => p['angle_id'] === angle['id']);
      if (prompt) {
        lines.push(`IMAGE AD (${prompt['layout']}):`);
        lines.push(`  Headline: ${prompt['headline']}`);
        lines.push(`  Subtext: ${prompt['subtext']}`);
        lines.push(`  Prompt: ${prompt['prompt']}`);
        lines.push('');
      }
    }

    lines.push('=== PLATFORM COPIES ===');
    for (const [platform, copy] of Object.entries(copies)) {
      lines.push(`\n[${platform.toUpperCase()}]`);
      for (const [field, value] of Object.entries(copy)) {
        lines.push(`  ${field}: ${value}`);
      }
    }

    lines.push('\n=== HASHTAGS ===');
    for (const [platform, tags] of Object.entries(hashtags)) {
      lines.push(`[${platform}] ${(tags as string[]).map((t) => `#${t}`).join(' ')}`);
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(lines.join('\n'));
  } catch (e: unknown) {
    next(e);
  }
});

adminRouter.put('/pipeline/enabled', async (req, res, next) => {
  try {
    const parsed = ToggleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const value = parsed.data.enabled ? '1' : '0';
    await redisClient.set('pipeline:enabled', value);
    await logPipelineEvent({
      stage: 'admin',
      status: 'ok',
      message: 'pipeline enabled flag updated',
      payload: { enabled: parsed.data.enabled }
    });

    res.status(200).json({ ok: true, enabled: parsed.data.enabled });
  } catch (e: unknown) {
    next(e);
  }
});

