import { randomUUID } from 'node:crypto';
import { query } from '../../config/db';

function nowIso(): string {
  return new Date().toISOString();
}

export async function seedDemoData(params?: { count?: number }): Promise<{ listingIds: string[] }> {
  const count = Math.max(1, Math.min(10, params?.count ?? 3));
  const listingIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const productId = randomUUID();
    const supplierId = randomUUID();
    const listingId = randomUUID();

    const keyword = `demo product ${i + 1}`;
    const title = `Demo Product ${i + 1} — Smart Gadget`;
    const tags = ['demo', 'gadget', 'smart', 'home', 'gift'];
    const costUsd = 12.5 + i * 2;
    const retailUsd = 39.99 + i * 5;
    const marginPct = ((retailUsd - costUsd) / retailUsd) * 100;

    const upserted = await query<{ id: string }>(
      `
      INSERT INTO trending_products (
        id, keyword, source, trend_score, status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, now(), now())
      ON CONFLICT (keyword) DO UPDATE
      SET
        source = EXCLUDED.source,
        trend_score = EXCLUDED.trend_score,
        status = EXCLUDED.status,
        updated_at = now()
      RETURNING id
      `,
      [productId, keyword, i % 2 === 0 ? 'tiktok' : 'amazon', 0.75, 'pending_content']
    );

    const productIdUsed = upserted[0]?.id ?? productId;

    await query(
      `
      INSERT INTO suppliers (
        id, product_id, platform, supplier_url, product_title, price_usd, moq, rating, review_count,
        shipping_days, fast_ship, supplier_score, images, vetted, rank, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
      `,
      [
        supplierId,
        productIdUsed,
        'aliexpress',
        'https://example.com/supplier',
        title,
        costUsd,
        1,
        4.7,
        123,
        10,
        false,
        0.9,
        JSON.stringify(['https://res.cloudinary.com/demo/image/upload/sample.jpg']),
        false,
        1
      ]
    );

    await query(
      `
      INSERT INTO product_listings (
        id, product_id, supplier_id, title, description, bullet_points, tags,
        seo_title, seo_description, cost_usd, retail_usd, margin_pct, status,
        images, created_at, updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,$13,
        $14, now(), now()
      )
      `,
      [
        listingId,
        productIdUsed,
        supplierId,
        title,
        `This is a demo listing generated at ${nowIso()}. Replace with real GPT content once keys are configured.`,
        JSON.stringify([
          'Feature 1: Works out of the box',
          'Feature 2: Lightweight and durable',
          'Feature 3: Great for gifts',
          'Feature 4: Easy setup',
          'Feature 5: Limited demo stock'
        ]),
        tags,
        title.slice(0, 70),
        'Demo SEO description for local testing.',
        costUsd,
        retailUsd,
        Math.round(marginPct * 100) / 100,
        'pending_review',
        JSON.stringify(['https://res.cloudinary.com/demo/image/upload/sample.jpg'])
      ]
    );

    listingIds.push(listingId);
  }

  return { listingIds };
}

