/**
 * Drives research + approval + publish-queue until N listings are **actually** `published`
 * in Postgres (not merely queued). Optional wall clock cap.
 *
 * Flags: `--limit`, `--batch`, `--pollMs`, `--reviewedBy`, `--source amazon|any`,
 * `--timeoutMs` (0 = no cap; if set and target not met → exit **3**).
 *
 * Exit: **0** success, **1** error, **3** timeout before `limit` published.
 */
import 'dotenv/config';

import { query } from '../config/db';
import logger from '../shared/logger';
import { publishProductQueue, researchSuppliersQueue } from '../queues/pipeline.queue';

type Args = {
  limit: number;
  batch: number;
  pollMs: number;
  reviewedBy: string;
  source: 'amazon' | 'any';
  /** 0 = run until limit (no time cap). */
  timeoutMs: number;
};

function getArg(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function toInt(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Non-negative int (0 allowed), for timeouts. */
function toUint(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

async function countPublishedShopify(params: {
  source: Args['source'];
}): Promise<number> {
  if (params.source === 'any') {
    const rows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM product_listings WHERE status = 'published'`
    );
    return Number(rows[0]?.n ?? 0);
  }
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM product_listings pl
     JOIN trending_products tp ON tp.id = pl.product_id
     WHERE pl.status = 'published'
       AND tp.source = $1`,
    [params.source]
  );
  return Number(rows[0]?.n ?? 0);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function approveListing(listingId: string, reviewedBy: string): Promise<void> {
  await query(
    `UPDATE product_listings
     SET status='approved', reviewed_by=$2, reviewed_at=now()
     WHERE id=$1`,
    [listingId, reviewedBy]
  );
}

async function main(): Promise<void> {
  const rawSource = (getArg('source') as Args['source']) ?? 'amazon';
  const source = rawSource === 'any' || rawSource === 'amazon' ? rawSource : 'amazon';

  const args: Args = {
    limit: toInt(getArg('limit'), 1),
    batch: toInt(getArg('batch'), 5),
    pollMs: toInt(getArg('pollMs'), 5000),
    reviewedBy: getArg('reviewedBy') ?? 'pipeline-auto',
    source,
    timeoutMs: toUint(getArg('timeoutMs'), 0)
  };

  const startedAt = Date.now();
  const deadlineMs = args.timeoutMs > 0 ? startedAt + args.timeoutMs : null;

  logger.info('auto-run starting', { args });

  while ((await countPublishedShopify({ source: args.source })) < args.limit) {
    if (deadlineMs !== null && Date.now() >= deadlineMs) {
      const publishedNow = await countPublishedShopify({ source: args.source });
      logger.warn('auto-run timeout before reaching publish target', {
        published: publishedNow,
        target: args.limit,
        timeoutMs: args.timeoutMs
      });
      process.exitCode = 3;
      return;
    }

    // 1) Enqueue research for a batch of pending_research products
    const productRows = await query<{ id: string }>(
      `SELECT id
       FROM trending_products
       WHERE status = 'pending_research'
         AND ($1::text = 'any' OR source = $1::text)
       ORDER BY created_at DESC
       LIMIT $2`,
      [args.source, args.batch]
    );
    for (const p of productRows) {
      await researchSuppliersQueue.add('research-suppliers', { productId: p.id });
    }

    // 2) Approve and enqueue publish for newest pending_review listings
    const publishedCount = await countPublishedShopify({ source: args.source });
    const remaining = args.limit - publishedCount;

    const listingRows = await query<{ id: string }>(
      `SELECT id
       FROM product_listings
       WHERE status = 'pending_review'
       ORDER BY created_at DESC
       LIMIT $1`,
      [Math.min(Math.max(remaining, 0), args.batch)]
    );

    let queuedPublish = 0;
    for (const l of listingRows) {
      await approveListing(l.id, args.reviewedBy);
      await publishProductQueue.add('publish-product', { listingId: l.id });
      queuedPublish += 1;
      logger.info('approved_and_queued_publish', { listingId: l.id, queuedPublish });

      const after = await countPublishedShopify({ source: args.source });
      if (after >= args.limit) break;
    }

    const currentPublished = await countPublishedShopify({ source: args.source });
    if (currentPublished >= args.limit) break;

    await sleep(args.pollMs);
  }

  const finalPublished = await countPublishedShopify({ source: args.source });
  logger.info('auto-run complete', { published: finalPublished, target: args.limit });
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

