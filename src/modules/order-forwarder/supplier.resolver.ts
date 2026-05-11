import { query } from '../../config/db';
import type { IncomingOrderLineItem, SupplierPlatform } from '../../shared/types';
import {
  extractAliExpressProductId,
  type ResolvedOrderItem
} from './aliexpress.placeorder';

/**
 * What `lookupBySupplierShopifyId` returns for a single Shopify product.
 */
export interface SupplierLookupResult {
  listingId: string;
  supplierId: string;
  platform: SupplierPlatform;
  supplierUrl: string;
}

/**
 * Boundary contract: given a Shopify numeric product_id, return the matching
 * `(listing, supplier)` pair from our DB — or null if not found.
 */
export type SupplierLookup = (
  shopifyProductId: string
) => Promise<SupplierLookupResult | null>;

/**
 * Either `ok` with resolved items + supplier, or `manual_review` with a human-readable reason.
 */
export type ResolveResult =
  | {
      kind: 'ok';
      aliexpressSupplierId: string;
      items: ResolvedOrderItem[];
    }
  | {
      kind: 'manual_review';
      reason: string;
    };

/**
 * Resolves Shopify line items into AE-supplier-keyed forwarding items.
 *
 * Constraints in this slice (by design):
 *  - All items must map to the SAME `suppliers` row (single AliExpress order).
 *  - All items must be on the `aliexpress` platform.
 *  - Each supplier_url must yield an extractable AE product id.
 *
 * Anything else returns `kind: 'manual_review'` so a human can intervene.
 */
export async function resolveSuppliersForOrder(
  lineItems: IncomingOrderLineItem[],
  lookup: SupplierLookup
): Promise<ResolveResult> {
  if (lineItems.length === 0) {
    return { kind: 'manual_review', reason: 'Order has no usable line items.' };
  }

  const resolvedItems: ResolvedOrderItem[] = [];
  const supplierIds = new Set<string>();

  for (const li of lineItems) {
    const r = await lookup(li.shopifyProductId);
    if (!r) {
      return {
        kind: 'manual_review',
        reason: `No listing found for shopify_product_id=${li.shopifyProductId}.`
      };
    }
    if (r.platform !== 'aliexpress') {
      return {
        kind: 'manual_review',
        reason: `Listing for shopify_product_id=${li.shopifyProductId} uses non-aliexpress supplier (${r.platform}); auto-forward only supports AliExpress in this slice.`
      };
    }

    const aeProductId = extractAliExpressProductId(r.supplierUrl);
    if (!aeProductId) {
      return {
        kind: 'manual_review',
        reason: `Could not extract AliExpress product id from supplier_url for listing ${r.listingId}.`
      };
    }

    supplierIds.add(r.supplierId);
    resolvedItems.push({
      aliexpressProductId: aeProductId,
      skuAttr: null,
      logisticsServiceName: null,
      quantity: li.quantity
    });
  }

  if (supplierIds.size > 1) {
    return {
      kind: 'manual_review',
      reason: `Order spans multiple suppliers (${supplierIds.size}); first-slice forwarder requires a single AliExpress supplier per order.`
    };
  }

  // safe — supplierIds has exactly 1 entry by this point
  const aliexpressSupplierId = Array.from(supplierIds)[0]!;

  return {
    kind: 'ok',
    aliexpressSupplierId,
    items: resolvedItems
  };
}

/**
 * Default DB-backed lookup used in production. Looks up the most-recent
 * `(listing, supplier)` pair for a Shopify product id.
 *
 * Notes:
 *  - We join on `product_listings.shopify_id` (set by the publisher when
 *    the product was created on Shopify).
 *  - When multiple listings share the same Shopify product (shouldn't happen,
 *    but historically possible during cleanup), we take the newest.
 */
export const defaultSupplierLookup: SupplierLookup = async (shopifyProductId) => {
  const rows = await query<{
    listing_id: string;
    supplier_id: string;
    platform: SupplierPlatform;
    supplier_url: string;
  }>(
    `SELECT pl.id          AS listing_id,
            s.id           AS supplier_id,
            s.platform     AS platform,
            s.supplier_url AS supplier_url
       FROM product_listings pl
       JOIN suppliers s ON s.id = pl.supplier_id
      WHERE pl.shopify_id = $1
      ORDER BY pl.updated_at DESC
      LIMIT 1`,
    [shopifyProductId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    listingId: r.listing_id,
    supplierId: r.supplier_id,
    platform: r.platform,
    supplierUrl: r.supplier_url
  };
};
