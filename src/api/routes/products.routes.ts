import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db';

export const productsRouter = Router();

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return 0;
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

const ApproveSchema = z.object({
  reviewedBy: z.string().min(1),
  shopifyStatus: z.enum(['ACTIVE', 'DRAFT']).optional()
});

const RejectSchema = z.object({
  reviewedBy: z.string().min(1),
  reason: z.string().min(1)
});

productsRouter.get('/', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending_review';
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
    const offset = typeof req.query.offset === 'string' ? Number(req.query.offset) : 0;

    const rows = await query<{
      id: string;
      product_id: string;
      supplier_id: string;
      title: string;
      description: string;
      tags: string[];
      images: unknown;
      cost_usd: number;
      retail_usd: number;
      margin_pct: number;
      status: string;
      source: string | null;
      trend_score: number | null;
    }>(
      `SELECT
         pl.id,
         pl.product_id,
         pl.supplier_id,
         pl.title,
         pl.description,
         pl.tags,
         pl.images,
         pl.cost_usd,
         pl.retail_usd,
         pl.margin_pct,
         pl.status,
         tp.source,
         tp.trend_score
       FROM product_listings pl
       LEFT JOIN trending_products tp ON tp.id = pl.product_id
       WHERE pl.status = $1
       ORDER BY pl.created_at DESC
       LIMIT $2 OFFSET $3`,
      [
        status,
        Number.isFinite(limit) ? limit : 20,
        Number.isFinite(offset) ? offset : 0
      ]
    );

    const productIds = rows
      .map((r) => r.product_id)
      .filter((id): id is string => typeof id === 'string');

    const suppliers =
      productIds.length === 0
        ? []
        : await query<{
            id: string;
            product_id: string;
            platform: 'aliexpress' | 'alibaba' | '1688';
            supplier_url: string;
            price_usd: number;
            moq: number;
            rating: number | null;
            shipping_days: number | null;
            supplier_score: number | null;
            rank: number | null;
          }>(
            `SELECT *
             FROM suppliers
             WHERE product_id = ANY($1::uuid[])
             ORDER BY product_id, rank ASC NULLS LAST, supplier_score DESC NULLS LAST`,
            [productIds]
          );

    const suppliersByProduct = new Map<
      string,
      Array<{
        id: string;
        platform: 'aliexpress' | 'alibaba' | '1688';
        supplierUrl: string;
        priceUsd: number;
        moq: number;
        rating: number | null;
        shippingDays: number | null;
        supplierScore: number | null;
        rank: number | null;
      }>
    >();
    for (const s of suppliers) {
      const pid = s.product_id;
      const arr = suppliersByProduct.get(pid) ?? [];
      arr.push({
        id: s.id,
        platform: s.platform,
        supplierUrl: s.supplier_url,
        priceUsd: toNumber(s.price_usd),
        moq: s.moq,
        rating: s.rating === null ? null : toNumber(s.rating),
        shippingDays: s.shipping_days,
        supplierScore: s.supplier_score === null ? null : toNumber(s.supplier_score),
        rank: s.rank
      });
      suppliersByProduct.set(pid, arr);
    }

    res.json({
      items: rows.map((r) => ({
        id: r.id,
        productId: r.product_id,
        supplierId: r.supplier_id,
        title: r.title,
        description: r.description,
        tags: r.tags,
        images: parseJsonArray(r.images).filter((v): v is string => typeof v === 'string'),
        costUsd: toNumber(r.cost_usd),
        retailUsd: toNumber(r.retail_usd),
        marginPct: toNumber(r.margin_pct),
        status: r.status,
        source: r.source,
        trendScore: r.trend_score,
        suppliers: suppliersByProduct.get(r.product_id) ?? []
      }))
    });
  } catch (e: unknown) {
    next(e);
  }
});

const EditSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  retailUsd: z.number().positive().optional(),
  tags: z.array(z.string()).optional()
});

productsRouter.put('/:id', async (req, res, next) => {
  try {
    const listingId = req.params.id;
    const body = EditSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    const existing = await query<{ cost_usd: number }>(
      'SELECT cost_usd FROM product_listings WHERE id = $1 LIMIT 1',
      [listingId]
    );
    const cost = existing[0]?.cost_usd ?? 0;

    const updates: string[] = [];
    const values: unknown[] = [listingId];
    let idx = 2;

    if (body.data.title !== undefined) {
      updates.push(`title = $${idx++}`);
      values.push(body.data.title);
    }
    if (body.data.description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(body.data.description);
    }
    if (body.data.tags !== undefined) {
      updates.push(`tags = $${idx++}`);
      values.push(body.data.tags);
    }
    if (body.data.retailUsd !== undefined) {
      const retail = body.data.retailUsd;
      const marginPct = retail > 0 ? ((retail - cost) / retail) * 100 : 0;
      updates.push(`retail_usd = $${idx++}`);
      values.push(retail);
      updates.push(`margin_pct = $${idx++}`);
      values.push(Math.round(marginPct * 100) / 100);
    }

    if (updates.length > 0) {
      await query(
        `UPDATE product_listings SET ${updates.join(', ')}, updated_at = now() WHERE id = $1`,
        values
      );
    }

    const updated = await query<Record<string, unknown>>(
      'SELECT * FROM product_listings WHERE id = $1 LIMIT 1',
      [listingId]
    );

    res.json(updated[0] ?? null);
  } catch (e: unknown) {
    next(e);
  }
});

productsRouter.post('/:id/approve', async (req, res, next) => {
  try {
    const listingId = req.params.id;
    const body = ApproveSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    await query(
      `UPDATE product_listings
       SET status='approved', reviewed_by=$2, reviewed_at=now()
       WHERE id=$1`,
      [listingId, body.data.reviewedBy]
    );

    const jobPayload: { listingId: string; shopifyStatus?: 'ACTIVE' | 'DRAFT' } = {
      listingId
    };
    if (body.data.shopifyStatus !== undefined) {
      jobPayload.shopifyStatus = body.data.shopifyStatus;
    }

    const { publishProductQueue } = await import('../../queues/pipeline.queue');
    await publishProductQueue.add('publish-product', jobPayload);

    res.json({ success: true, listingId });
  } catch (e: unknown) {
    next(e);
  }
});

productsRouter.post('/:id/reject', async (req, res, next) => {
  try {
    const listingId = req.params.id;
    const body = RejectSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'reason_required' });
      return;
    }

    await query(
      `UPDATE product_listings
       SET status='rejected', review_notes=$2, reviewed_by=$3, reviewed_at=now()
       WHERE id=$1`,
      [listingId, body.data.reason, body.data.reviewedBy]
    );

    res.json({ success: true, listingId });
  } catch (e: unknown) {
    next(e);
  }
});
