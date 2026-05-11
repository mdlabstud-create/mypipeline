import { describe, expect, it, vi } from 'vitest';
import {
  forwardOrder,
  type ForwarderDependencies
} from '../../src/modules/order-forwarder/forwarder.service';
import type { IncomingOrder } from '../../src/shared/types';
import type {
  SupplierLookupResult
} from '../../src/modules/order-forwarder/supplier.resolver';

function order(): IncomingOrder {
  return {
    shopifyOrderId: 'so-1',
    shopifyOrderName: '#1001',
    email: 'b@x.com',
    currency: 'USD',
    totalPriceUsd: 49.99,
    shippingAddress: {
      fullName: 'Jane Doe',
      address1: '123 Main',
      address2: null,
      city: 'NYC',
      province: 'NY',
      zip: '10001',
      country: 'US',
      phone: '+1-555',
      phoneCountry: '1',
      email: 'b@x.com'
    },
    lineItems: [
      {
        shopifyProductId: 'sp1',
        shopifyVariantId: 'sv1',
        sku: null,
        title: 't',
        quantity: 1
      }
    ]
  };
}

const supplierFor = (sup: string): SupplierLookupResult => ({
  listingId: 'l1',
  supplierId: sup,
  platform: 'aliexpress',
  supplierUrl: 'https://www.aliexpress.com/item/1005006789012345.html'
});

function makeDeps(overrides: Partial<ForwarderDependencies> = {}): {
  deps: ForwarderDependencies;
  writes: Array<Record<string, unknown>>;
  placeOrder: ReturnType<typeof vi.fn>;
} {
  const writes: Array<Record<string, unknown>> = [];
  const placeOrder = vi.fn(async () => ({
    aliexpressOrderId: 'AE-9999',
    raw: { result: { orderList: ['AE-9999'] } }
  }));
  const deps: ForwarderDependencies = {
    lookup: () => Promise.resolve(supplierFor('sup-A')),
    placeOrder,
    persistResult: (r) => {
      writes.push(r as unknown as Record<string, unknown>);
      return Promise.resolve();
    },
    dryRun: false,
    ...overrides
  };
  return { deps, writes, placeOrder };
}

describe('forwardOrder', () => {
  it('places the order via AE and persists status=placed', async () => {
    const { deps, writes, placeOrder } = makeDeps();

    const out = await forwardOrder(order(), deps);

    expect(out.status).toBe('placed');
    expect(out.aliexpressOrderId).toBe('AE-9999');
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.status).toBe('placed');
    expect(writes[0]?.aliexpressOrderId).toBe('AE-9999');
    expect(writes[0]?.aliexpressSupplierId).toBe('sup-A');
  });

  it('honors dry-run: builds the command but does NOT call placeOrder', async () => {
    const { deps, writes, placeOrder } = makeDeps({ dryRun: true });

    const out = await forwardOrder(order(), deps);

    expect(out.status).toBe('dry_run');
    expect(out.aliexpressOrderId).toBeNull();
    expect(placeOrder).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.status).toBe('dry_run');
    expect(writes[0]?.requestPayload).toBeTruthy(); // built, just not sent
  });

  it('parks the order when resolver returns manual_review', async () => {
    const { deps, writes, placeOrder } = makeDeps({
      lookup: async () => null
    });

    const out = await forwardOrder(order(), deps);

    expect(out.status).toBe('manual_review');
    expect(placeOrder).not.toHaveBeenCalled();
    expect(writes[0]?.status).toBe('manual_review');
    expect(writes[0]?.errorMessage).toMatch(/no listing/i);
  });

  it('parks when shipping address is missing (cannot build command)', async () => {
    const o = order();
    o.shippingAddress = null;

    const { deps, writes, placeOrder } = makeDeps();
    const out = await forwardOrder(o, deps);

    expect(out.status).toBe('manual_review');
    expect(placeOrder).not.toHaveBeenCalled();
    expect(writes[0]?.errorMessage).toMatch(/shipping address/i);
  });

  it('records error status when placeOrder rejects', async () => {
    const { deps, writes } = makeDeps({
      placeOrder: vi.fn(async () => {
        throw new Error('AE 500: try again');
      })
    });

    const out = await forwardOrder(order(), deps);

    expect(out.status).toBe('error');
    expect(out.errorMessage).toMatch(/AE 500/);
    expect(writes[0]?.status).toBe('error');
  });

  it('passes the resolved supplier id through to persistence', async () => {
    const { deps, writes } = makeDeps({
      lookup: async () => supplierFor('sup-XYZ')
    });

    await forwardOrder(order(), deps);
    expect(writes[0]?.aliexpressSupplierId).toBe('sup-XYZ');
  });
});
