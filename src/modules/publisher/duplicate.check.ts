import { query } from '../../config/db';

/**
 * Finds a published listing that used the same AliExpress `product_title` as the current supplier.
 * Returns the existing listing's id, shopify_id, handle and margin so the caller can decide
 * whether to skip or update.
 */
export async function findPublishedDuplicateBySupplierTitle(
  listingId: string,
  supplierId: string
): Promise<{ listingId: string; shopifyId: string; shopifyHandle: string; marginPct: number } | null> {
  const supplierRows = await query<{ product_title: string | null }>(
    'SELECT product_title FROM suppliers WHERE id = $1 LIMIT 1',
    [supplierId]
  );
  const productTitle = supplierRows[0]?.product_title?.trim() ?? null;
  if (!productTitle) return null;

  const rows = await query<{ id: string; shopify_id: string; shopify_handle: string | null; margin_pct: number }>(
    `SELECT pl.id, pl.shopify_id, pl.shopify_handle, pl.margin_pct::float8 AS margin_pct
     FROM product_listings pl
     JOIN suppliers s ON s.id = pl.supplier_id
     WHERE s.product_title = $1
       AND pl.id <> $2
       AND pl.status = 'published'
       AND pl.shopify_id IS NOT NULL
     ORDER BY pl.margin_pct DESC
     LIMIT 1`,
    [productTitle, listingId]
  );

  const row = rows[0];
  if (!row) return null;
  return {
    listingId: row.id,
    shopifyId: row.shopify_id,
    shopifyHandle: row.shopify_handle ?? '',
    marginPct: row.margin_pct
  };
}

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