import { query } from '../../config/db';
import type { ProductListing, ProductListingStatus } from '../../shared/types';

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string');
  return [];
}

/** Safe string for DB driver values (avoids no-base-to-string on `String(unknown)`). */
function cellToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return '';
}

function optionalCellString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return null;
}

/**
 * Maps a node-postgres row (snake_case) into the camelCase listing model used by Shopify publishing.
 */
export function mapListingRow(row: Record<string, unknown>): ProductListing {
  const imgs = row.images;
  let images: string[] = [];
  if (Array.isArray(imgs)) {
    images = imgs.filter((x): x is string => typeof x === 'string');
  } else if (typeof imgs === 'string') {
    try {
      const parsed = JSON.parse(imgs) as unknown;
      images = asStringArray(parsed);
    } catch {
      images = [];
    }
  }

  const bullets = row.bullet_points;
  let bulletPoints: string[] = [];
  if (Array.isArray(bullets)) {
    bulletPoints = bullets.filter((x): x is string => typeof x === 'string');
  } else if (typeof bullets === 'string') {
    try {
      const parsed = JSON.parse(bullets) as unknown;
      bulletPoints = asStringArray(parsed);
    } catch {
      bulletPoints = [];
    }
  }

  return {
    id: cellToString(row.id),
    productId: cellToString(row.product_id),
    supplierId: cellToString(row.supplier_id),
    title: cellToString(row.title),
    description: cellToString(row.description),
    bulletPoints,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    seoTitle: optionalCellString(row.seo_title),
    seoDescription: optionalCellString(row.seo_description),
    images,
    costUsd: Number(row.cost_usd),
    retailUsd: Number(row.retail_usd),
    marginPct: Number(row.margin_pct),
    shopifyId: optionalCellString(row.shopify_id),
    shopifyHandle: optionalCellString(row.shopify_handle),
    status: row.status as ProductListingStatus,
    reviewNotes: optionalCellString(row.review_notes),
    reviewedBy: optionalCellString(row.reviewed_by),
    reviewedAt: optionalCellString(row.reviewed_at),
    publishedAt: optionalCellString(row.published_at),
    createdAt: optionalCellString(row.created_at) ?? '',
    updatedAt: optionalCellString(row.updated_at) ?? ''
  };
}

/**
 * Minimal listing record used by publisher gate checks.
 */
export interface ListingGateRecord {
  id: string;
  status: ProductListingStatus;
}

/**
 * Loads a listing by id for publisher gate checks.
 */
export async function getListingById(listingId: string): Promise<ListingGateRecord> {
  const sql = 'SELECT id, status FROM product_listings WHERE id = $1 LIMIT 1';
  const rows = await query<{ id: string; status: ProductListingStatus }>(sql, [
    listingId
  ]);
  const row = rows[0];
  if (!row) {
    return { id: listingId, status: 'error' };
  }
  return row;
}

/**
 * Full listing record loader used by Shopify publisher.
 */
export async function getFullListingById(
  listingId: string
): Promise<ProductListing | null> {
  const sql = 'SELECT * FROM product_listings WHERE id = $1 LIMIT 1';
  const rows = await query<Record<string, unknown>>(sql, [listingId]);
  const row = rows[0];
  if (!row) return null;

  return mapListingRow(row);
}