import { query } from '../../config/db';

/**
 * Checks for duplicates using internal DB heuristics.
 *
 * Same `product_id` already live on Shopify => do not create another storefront product (GPT titles differ).
 */
export async function checkDuplicate(
  listingId: string,
  title: string,
  tags: string[],
  productId: string
): Promise<boolean> {
  const siblingShopify = await query<{ id: string }>(
    `SELECT id FROM product_listings
     WHERE product_id = $1
       AND id <> $2
       AND shopify_id IS NOT NULL
       AND status = 'published'
     LIMIT 1`,
    [productId, listingId]
  );

  if (siblingShopify.length > 0) return true;

  const rows = await query<{ title: string; tags: string[] }>(
    'SELECT title, tags FROM product_listings WHERE title = $1 AND id <> $2 LIMIT 1',
    [title, listingId]
  );

  if (rows.length > 0) return true;

  const candidates = await query<{ tags: string[] }>(
    'SELECT tags FROM product_listings WHERE id <> $1 ORDER BY created_at DESC LIMIT 50',
    [listingId]
  );

  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  for (const c of candidates) {
    const other = new Set((c.tags ?? []).map((t) => t.toLowerCase()));
    let overlap = 0;
    for (const t of tagSet) {
      if (other.has(t)) overlap += 1;
    }
    const denom = Math.max(tagSet.size, 1);
    if (overlap / denom > 0.6) return true;
  }

  return false;
}