import 'dotenv/config';

import { query } from '../config/db';
import logger from '../shared/logger';
import { researchProduct } from '../modules/researcher/researcher.service';
import { getFreshAliExpressSession } from '../modules/researcher/aliexpress.session';
import { generateContent } from '../modules/content-generator/content.service';
import { publishToShopify } from '../modules/publisher/shopify.service';

async function approveListing(listingId: string): Promise<void> {
  await query(
    `UPDATE product_listings
     SET status='approved', reviewed_by=$2, reviewed_at=now()
     WHERE id=$1`,
    [listingId, 'aliexpress-test']
  );
}

async function main(): Promise<void> {
  try {
    await getFreshAliExpressSession();
  } catch (err: unknown) {
    logger.error('AliExpress session unavailable', { error: String(err) });
    process.exit(1);
  }

  const products = await query<{ id: string; keyword: string }>(
    `SELECT id, keyword
     FROM trending_products
     WHERE status='pending_research'
     ORDER BY created_at DESC
     LIMIT 3`
  );

  if (products.length < 3) {
    logger.error('Not enough pending_research products for test batch', { found: products.length });
    process.exit(1);
  }

  const listingIds: string[] = [];
  for (const p of products) {
    logger.info('aliexpress batch researching', { productId: p.id, keyword: p.keyword });
    await researchProduct(p.id);
    logger.info('aliexpress batch generating content', { productId: p.id });
    const listingId = await generateContent(p.id);
    if (!listingId) {
      logger.warn('content generation returned null', { productId: p.id });
      continue;
    }
    listingIds.push(listingId);
    await approveListing(listingId);
    await publishToShopify(listingId, { shopifyStatus: 'DRAFT' });
    logger.info('aliexpress batch published draft', { listingId });
  }

  if (listingIds.length > 0) {
    logger.info('aliexpress batch complete', { listingIds });
  } else {
    logger.warn('aliexpress batch produced no listings', {});
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

