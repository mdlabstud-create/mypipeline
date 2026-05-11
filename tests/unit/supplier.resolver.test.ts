import { describe, expect, it } from 'vitest';
import {
  resolveSuppliersForOrder,
  type SupplierLookup,
  type SupplierLookupResult
} from '../../src/modules/order-forwarder/supplier.resolver';
import type { IncomingOrderLineItem } from '../../src/shared/types';

function lookupFromMap(
  map: Record<string, SupplierLookupResult | null>
): SupplierLookup {
  return (shopifyProductId: string) => Promise.resolve(map[shopifyProductId] ?? null);
}

function lineItem(
  shopifyProductId: string,
  overrides: Partial<IncomingOrderLineItem> = {}
): IncomingOrderLineItem {
  return {
    shopifyProductId,
    shopifyVariantId: null,
    sku: null,
    title: 'Item',
    quantity: 1,
    ...overrides
  };
}

describe('resolveSuppliersForOrder', () => {
  it('resolves a single line item to its AE supplier', async () => {
    const lookup = lookupFromMap({
      shop_p1: {
        listingId: 'listing-1',
        supplierId: 'supplier-1',
        platform: 'aliexpress',
        supplierUrl: 'https://www.aliexpress.com/item/1005006789012345.html'
      }
    });

    const out = await resolveSuppliersForOrder(
      [lineItem('shop_p1', { quantity: 3 })],
      lookup
    );

    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.aliexpressSupplierId).toBe('supplier-1');
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.aliexpressProductId).toBe('1005006789012345');
    expect(out.items[0]?.quantity).toBe(3);
    expect(out.items[0]?.skuAttr).toBeNull();
  });

  it('resolves multiple line items sharing the same supplier', async () => {
    const lookup = lookupFromMap({
      shop_p1: {
        listingId: 'l1',
        supplierId: 'supplier-1',
        platform: 'aliexpress',
        supplierUrl: 'https://www.aliexpress.com/item/111.html'
      },
      shop_p2: {
        listingId: 'l2',
        supplierId: 'supplier-1',
        platform: 'aliexpress',
        supplierUrl: 'https://www.aliexpress.com/item/222.html'
      }
    });

    const out = await resolveSuppliersForOrder(
      [lineItem('shop_p1'), lineItem('shop_p2')],
      lookup
    );

    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.items.map((i) => i.aliexpressProductId)).toEqual(['111', '222']);
  });

  it('parks the order when line items map to different AE suppliers', async () => {
    const lookup = lookupFromMap({
      shop_p1: {
        listingId: 'l1',
        supplierId: 'supplier-A',
        platform: 'aliexpress',
        supplierUrl: 'https://www.aliexpress.com/item/111.html'
      },
      shop_p2: {
        listingId: 'l2',
        supplierId: 'supplier-B',
        platform: 'aliexpress',
        supplierUrl: 'https://www.aliexpress.com/item/222.html'
      }
    });

    const out = await resolveSuppliersForOrder(
      [lineItem('shop_p1'), lineItem('shop_p2')],
      lookup
    );

    expect(out.kind).toBe('manual_review');
    if (out.kind === 'manual_review') {
      expect(out.reason).toMatch(/multiple suppliers/i);
    }
  });

  it('parks the order when any line item has no listing in the DB', async () => {
    const lookup = lookupFromMap({
      shop_p1: {
        listingId: 'l1',
        supplierId: 'supplier-1',
        platform: 'aliexpress',
        supplierUrl: 'https://www.aliexpress.com/item/111.html'
      },
      shop_p2: null // not found
    });

    const out = await resolveSuppliersForOrder(
      [lineItem('shop_p1'), lineItem('shop_p2')],
      lookup
    );

    expect(out.kind).toBe('manual_review');
    if (out.kind === 'manual_review') {
      expect(out.reason).toMatch(/no listing/i);
    }
  });

  it('parks the order when the supplier platform is not aliexpress', async () => {
    const lookup = lookupFromMap({
      shop_p1: {
        listingId: 'l1',
        supplierId: 'supplier-1',
        platform: 'amazon',
        supplierUrl: 'https://www.amazon.com/dp/B0XXX'
      }
    });

    const out = await resolveSuppliersForOrder([lineItem('shop_p1')], lookup);

    expect(out.kind).toBe('manual_review');
    if (out.kind === 'manual_review') {
      expect(out.reason).toMatch(/non-aliexpress/i);
    }
  });

  it('parks the order when supplier_url has no extractable AE product id', async () => {
    const lookup = lookupFromMap({
      shop_p1: {
        listingId: 'l1',
        supplierId: 'supplier-1',
        platform: 'aliexpress',
        supplierUrl: 'https://www.aliexpress.com/missing-id'
      }
    });

    const out = await resolveSuppliersForOrder([lineItem('shop_p1')], lookup);

    expect(out.kind).toBe('manual_review');
    if (out.kind === 'manual_review') {
      expect(out.reason).toMatch(/product id/i);
    }
  });

  it('returns manual_review when the order has no line items', async () => {
    const lookup = lookupFromMap({});
    const out = await resolveSuppliersForOrder([], lookup);
    expect(out.kind).toBe('manual_review');
  });
});
