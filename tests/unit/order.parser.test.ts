import { describe, expect, it } from 'vitest';
import { parseShopifyOrderWebhook } from '../../src/modules/order-forwarder/order.parser';

/**
 * Builds a realistic Shopify orders/create payload (subset). Real payloads have
 * 100+ fields; we only require a small slice.
 */
function shopifyOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 5_543_210_000_001,
    name: '#1001',
    email: 'buyer@example.com',
    currency: 'USD',
    total_price: '49.99',
    line_items: [
      {
        id: 9_999_111,
        product_id: 7_111_222_333,
        variant_id: 41_222_333_444,
        sku: 'SKU-A',
        title: 'Widget',
        quantity: 2
      }
    ],
    shipping_address: {
      first_name: 'Jane',
      last_name: 'Doe',
      address1: '123 Main St',
      address2: 'Apt 4',
      city: 'Brooklyn',
      province: 'New York',
      province_code: 'NY',
      zip: '11201',
      country_code: 'US',
      phone: '+1-555-0100'
    },
    ...overrides
  };
}

describe('parseShopifyOrderWebhook', () => {
  it('extracts the basic order envelope', () => {
    const out = parseShopifyOrderWebhook(shopifyOrder());
    expect(out).not.toBeNull();
    expect(out?.shopifyOrderId).toBe('5543210000001');
    expect(out?.shopifyOrderName).toBe('#1001');
    expect(out?.email).toBe('buyer@example.com');
    expect(out?.currency).toBe('USD');
    expect(out?.totalPriceUsd).toBe(49.99);
  });

  it('normalizes line items to string ids and integer quantities', () => {
    const out = parseShopifyOrderWebhook(shopifyOrder());
    expect(out?.lineItems).toHaveLength(1);
    const li = out?.lineItems[0];
    expect(li?.shopifyProductId).toBe('7111222333');
    expect(li?.shopifyVariantId).toBe('41222333444');
    expect(li?.sku).toBe('SKU-A');
    expect(li?.title).toBe('Widget');
    expect(li?.quantity).toBe(2);
  });

  it('extracts shipping address, preferring province_code over province', () => {
    const out = parseShopifyOrderWebhook(shopifyOrder());
    const a = out?.shippingAddress;
    expect(a).not.toBeNull();
    expect(a?.fullName).toBe('Jane Doe');
    expect(a?.address1).toBe('123 Main St');
    expect(a?.address2).toBe('Apt 4');
    expect(a?.city).toBe('Brooklyn');
    expect(a?.province).toBe('NY'); // province_code preferred
    expect(a?.zip).toBe('11201');
    expect(a?.country).toBe('US');
    expect(a?.phone).toBe('+1-555-0100');
    expect(a?.phoneCountry).toBe('1');
  });

  it('falls back to `province` when `province_code` is missing', () => {
    const raw = shopifyOrder();
    const ship = raw['shipping_address'] as Record<string, unknown>;
    delete ship['province_code'];
    const out = parseShopifyOrderWebhook(raw);
    expect(out?.shippingAddress?.province).toBe('New York');
  });

  it('returns null shippingAddress when shipping_address is absent', () => {
    const raw = shopifyOrder();
    delete raw['shipping_address'];
    const out = parseShopifyOrderWebhook(raw);
    expect(out?.shippingAddress).toBeNull();
  });

  it('drops line items without a product_id', () => {
    const raw = shopifyOrder({
      line_items: [
        { id: 1, title: 'Custom', quantity: 1 }, // no product_id
        { id: 2, product_id: 7_999, variant_id: null, sku: null, title: 'OK', quantity: 1 }
      ]
    });
    const out = parseShopifyOrderWebhook(raw);
    expect(out?.lineItems).toHaveLength(1);
    expect(out?.lineItems[0]?.shopifyProductId).toBe('7999');
  });

  it('handles missing variant_id / sku as null without crashing', () => {
    const raw = shopifyOrder({
      line_items: [{ id: 1, product_id: 7_999, title: 'No SKU', quantity: 1 }]
    });
    const out = parseShopifyOrderWebhook(raw);
    expect(out?.lineItems[0]?.shopifyVariantId).toBeNull();
    expect(out?.lineItems[0]?.sku).toBeNull();
  });

  it('returns null when payload is not an object', () => {
    expect(parseShopifyOrderWebhook(null)).toBeNull();
    expect(parseShopifyOrderWebhook('garbage')).toBeNull();
    expect(parseShopifyOrderWebhook(42)).toBeNull();
  });

  it('returns null when order id is missing', () => {
    const raw = shopifyOrder();
    delete raw['id'];
    expect(parseShopifyOrderWebhook(raw)).toBeNull();
  });

  it('coerces a string total_price to a number', () => {
    const out = parseShopifyOrderWebhook(shopifyOrder({ total_price: '199.95' }));
    expect(out?.totalPriceUsd).toBe(199.95);
  });

  it('returns null totalPriceUsd when total_price is not numeric', () => {
    const out = parseShopifyOrderWebhook(shopifyOrder({ total_price: 'NaN' }));
    expect(out?.totalPriceUsd).toBeNull();
  });

  it('handles an empty line_items array gracefully', () => {
    const out = parseShopifyOrderWebhook(shopifyOrder({ line_items: [] }));
    expect(out?.lineItems).toEqual([]);
  });
});
