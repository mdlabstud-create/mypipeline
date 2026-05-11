/**
 * Full pipeline reset script (with Redis gate clearing).
 * 1. Clears Redis pipeline gate keys for today.
 * 2. Deletes ALL products from Shopify (paginated).
 * 3. Truncates DB tables.
 * 4. Triggers the pipeline scraper.
 * 5. Polls until 10 listings reach status=published, then prints a summary.
 *
 * Run inside the app container:
 *   docker exec dropship-pipeline-app-1 npx tsx scripts/reset-and-run.ts
 */

import axios from 'axios';
import { query, pool } from '../src/config/db';
import redisClient from '../src/config/redis';
import { triggerManually } from '../src/queues/scheduler';

const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN ?? '';
const SHOPIFY_SHOP = process.env.SHOPIFY_STORE_URL ?? '';
const SHOPIFY_API = `https://${SHOPIFY_SHOP}/admin/api/2024-01`;

async function clearRedisGates(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const keys = [
    `pipeline:scraper_done:amazon:${today}`,
    `pipeline:scraper_done:tiktok:${today}`,
    `pipeline:merge_enqueued:${today}`
  ];
  for (const k of keys) {
    const del = await redisClient.del(k);
    console.log(`  DEL ${k} → ${del}`);
  }
}

async function deleteAllShopifyProducts(): Promise<void> {
  console.log('\n[2] Fetching Shopify products...');
  let pageInfo: string | undefined;
  let total = 0;

  do {
    const params: Record<string, string | number> = { limit: 250, fields: 'id' };
    if (pageInfo) params.page_info = pageInfo;

    const res = await axios.get<{ products: Array<{ id: number }> }>(
      `${SHOPIFY_API}/products.json`,
      { headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN }, params, timeout: 30_000 }
    );

    const products = res.data.products;
    if (products.length === 0) break;

    for (const p of products) {
      await axios.delete(`${SHOPIFY_API}/products/${p.id}.json`, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
        timeout: 15_000
      });
      total++;
      process.stdout.write(`\r  Deleted ${total} Shopify products...`);
      await new Promise((r) => setTimeout(r, 600));
    }

    const link = res.headers['link'] as string | undefined;
    const nextMatch = link?.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    pageInfo = nextMatch?.[1];
  } while (pageInfo);

  console.log(`\n  Done — deleted ${total} Shopify product(s).`);
}

async function resetDatabase(): Promise<void> {
  console.log('\n[3] Truncating database tables...');
  await query(`TRUNCATE TABLE
    forwarded_orders,
    pipeline_events,
    product_listings,
    suppliers,
    trending_products
    RESTART IDENTITY CASCADE`);
  console.log('  Done — all product tables cleared.');
}

async function triggerPipeline(): Promise<void> {
  console.log('\n[4] Triggering pipeline scraper...');
  await triggerManually();
  console.log('  Done — scraper jobs enqueued.');
}

async function waitForTenPublished(): Promise<void> {
  console.log('\n[5] Waiting for 10 published listings...\n');
  let lastCount = 0;
  let stableRounds = 0;

  for (let round = 1; ; round++) {
    await new Promise((r) => setTimeout(r, 20_000));

    const tp = await query<{ status: string; n: string }>(
      'SELECT status, COUNT(*)::text AS n FROM trending_products GROUP BY status ORDER BY status'
    );
    const pl = await query<{ status: string; n: string }>(
      'SELECT status, COUNT(*)::text AS n FROM product_listings GROUP BY status ORDER BY status'
    );

    const pubCount = Number(pl.find((r) => r.status === 'published')?.n ?? 0);
    const pendCount = Number(pl.find((r) => r.status === 'pending_review')?.n ?? 0);

    const tpLine = tp.map((r) => `${r.status}:${r.n}`).join('  ');
    const plLine = pl.map((r) => `${r.status}:${r.n}`).join('  ');
    console.log(`[round ${round}] tp → ${tpLine}`);
    console.log(`         pl → ${plLine || '(none)'}`);

    if (pendCount > 0) {
      const pending = await query<{ id: string }>(
        `SELECT id FROM product_listings WHERE status = 'pending_review' LIMIT 20`
      );
      for (const row of pending) {
        await query(
          `UPDATE product_listings SET status='approved', reviewed_by='auto-test', reviewed_at=now() WHERE id=$1`,
          [row.id]
        );
        const { publishProductQueue } = await import('../src/queues/pipeline.queue');
        await publishProductQueue.add('publish-product', { listingId: row.id });
        console.log(`  ↳ approved + enqueued ${row.id}`);
      }
    }

    if (pubCount >= 10) {
      console.log(`\n✅ ${pubCount} listings published — done!`);
      break;
    }

    console.log(`  published so far: ${pubCount}/10\n`);

    if (pubCount === lastCount) {
      stableRounds++;
      if (stableRounds >= 6) {
        console.log('  Pipeline stalled — enqueueing another merger round...');
        const { mergeProductsQueue } = await import('../src/queues/pipeline.queue');
        await mergeProductsQueue.add('merge-products', { triggeredAt: new Date().toISOString() });
        stableRounds = 0;
      }
    } else {
      stableRounds = 0;
      lastCount = pubCount;
    }
  }
}

async function printSummary(): Promise<void> {
  console.log('\n--- Final listings ---');
  const rows = await query<{ title: string; retail_usd: number; margin_pct: number; shopify_id: string | null; status: string }>(
    `SELECT title, retail_usd::float8, margin_pct::float8, shopify_id, status
     FROM product_listings ORDER BY created_at DESC LIMIT 15`
  );
  for (const l of rows) {
    const shopify = l.shopify_id ? `gid=${l.shopify_id}` : 'no-shopify-id';
    console.log(`  [${l.status.padEnd(14)}] $${l.retail_usd.toFixed(2).padStart(7)} | ${l.margin_pct.toFixed(1)}% | ${l.title.slice(0, 55)} (${shopify})`);
  }
}

void (async () => {
  try {
    console.log('[1] Clearing Redis pipeline gate keys...');
    await clearRedisGates();
    await deleteAllShopifyProducts();
    await resetDatabase();
    await triggerPipeline();
    await waitForTenPublished();
    await printSummary();
  } catch (err) {
    console.error('\n❌ Reset script failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
    await redisClient.quit();
    process.exit(0);
  }
})();
