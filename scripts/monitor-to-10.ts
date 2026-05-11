import { query, pool } from '../src/config/db';

async function tick(): Promise<number> {
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
  console.log(`  tp → ${tpLine}`);
  console.log(`  pl → ${plLine || '(none)'}`);

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
      console.log(`    ↳ approved + enqueued ${row.id}`);
    }
  }

  return pubCount;
}

void (async () => {
  console.log('Monitoring pipeline to 10 published... (checks every 20s, stops on 10 or 30min)');
  const deadline = Date.now() + 30 * 60_000;
  let round = 0;

  while (Date.now() < deadline) {
    round++;
    console.log(`\n[${new Date().toISOString()}] round ${round}`);
    const pub = await tick();
    if (pub >= 10) {
      console.log(`\n✅ ${pub} listings published — done!`);
      break;
    }
    console.log(`  published so far: ${pub}/10`);
    await new Promise((r) => setTimeout(r, 20_000));
  }

  console.log('\n--- Final listings ---');
  const rows = await query<{ title: string; retail_usd: number; margin_pct: number; shopify_id: string | null; status: string }>(
    `SELECT title, retail_usd::float8, margin_pct::float8, shopify_id, status
     FROM product_listings ORDER BY created_at DESC LIMIT 15`
  );
  for (const l of rows) {
    const shopify = l.shopify_id ? `gid=${l.shopify_id}` : 'no-shopify-id';
    console.log(`  [${l.status.padEnd(14)}] $${l.retail_usd.toFixed(2).padStart(7)} | ${l.margin_pct.toFixed(1)}% | ${l.title.slice(0, 55)} (${shopify})`);
  }

  await pool.end();
  process.exit(0);
})();
