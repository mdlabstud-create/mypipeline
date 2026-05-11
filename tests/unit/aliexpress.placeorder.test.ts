import { describe, expect, it } from 'vitest';
import {
  buildAliExpressPlaceOrderCommand,
  extractAliExpressProductId,
  type ResolvedOrderForForwarding
} from '../../src/modules/order-forwarder/aliexpress.placeorder';
import type { ShippingAddress } from '../../src/shared/types';

const address: ShippingAddress = {
  fullName: 'Jane Doe',
  address1: '123 Main St',
  address2: 'Apt 4',
  city: 'Brooklyn',
  province: 'NY',
  zip: '11201',
  country: 'US',
  phone: '+1-555-0100',
  phoneCountry: '1',
  email: 'buyer@example.com'
};

const baseResolved: ResolvedOrderForForwarding = {
  shopifyOrderId: '5543210000001',
  shippingAddress: address,
  items: [
    {
      aliexpressProductId: '1005006789012345',
      skuAttr: '14:200008701#Black;5:100014064',
      logisticsServiceName: 'CAINIAO_STANDARD',
      quantity: 2
    }
  ]
};

describe('extractAliExpressProductId', () => {
  it('parses /item/<digits>.html URLs', () => {
    expect(extractAliExpressProductId('https://www.aliexpress.com/item/1005006789012345.html')).toBe(
      '1005006789012345'
    );
  });

  it('parses #ae_pid=<digits> hash suffixes added by our parser', () => {
    expect(
      extractAliExpressProductId(
        'https://www.aliexpress.com/item/x.html?spm=tracking#ae_pid=1005006789012345'
      )
    ).toBe('1005006789012345');
  });

  it('returns null when no id can be found', () => {
    expect(extractAliExpressProductId('https://www.example.com/p/widget')).toBeNull();
    expect(extractAliExpressProductId('not a url')).toBeNull();
  });
});

describe('buildAliExpressPlaceOrderCommand', () => {
  it('produces a single-item place-order body', () => {
    const cmd = buildAliExpressPlaceOrderCommand(baseResolved);

    expect(cmd.method).toBe('aliexpress.trade.buy.placeorder');
    const body = cmd.body;
    expect(body).toHaveProperty('param_place_order_request4');
    const req = body.param_place_order_request4;

    // Address mapping
    expect(req.logistics_address.contact_person).toBe('Jane Doe');
    expect(req.logistics_address.full_name).toBe('Jane Doe');
    expect(req.logistics_address.address).toBe('123 Main St');
    expect(req.logistics_address.address2).toBe('Apt 4');
    expect(req.logistics_address.city).toBe('Brooklyn');
    expect(req.logistics_address.province).toBe('NY');
    expect(req.logistics_address.zip).toBe('11201');
    expect(req.logistics_address.country).toBe('US');
    expect(req.logistics_address.mobile_no).toBe('+1-555-0100');
    expect(req.logistics_address.phone_country).toBe('1');

    // Product items
    expect(req.product_items).toHaveLength(1);
    const item = req.product_items[0]!;
    expect(item.product_id).toBe('1005006789012345');
    expect(item.product_count).toBe(2);
    expect(item.sku_attr).toBe('14:200008701#Black;5:100014064');
    expect(item.logistics_service_name).toBe('CAINIAO_STANDARD');
  });

  it('serializes the request to JSON-string-in-form for the AE /sync endpoint', () => {
    const cmd = buildAliExpressPlaceOrderCommand(baseResolved);
    const params = cmd.toBizParams();
    expect(typeof params['param_place_order_request4']).toBe('string');
    const reparsed: Record<string, unknown> = JSON.parse(params['param_place_order_request4']!);
    expect(reparsed['product_items']).toEqual(cmd.body.param_place_order_request4.product_items);
  });

  it('omits address2 from JSON when null', () => {
    const cmd = buildAliExpressPlaceOrderCommand({
      ...baseResolved,
      shippingAddress: { ...address, address2: null }
    });
    const params = cmd.toBizParams();
    const reparsed: {
      logistics_address: Record<string, unknown>;
    } = JSON.parse(params['param_place_order_request4']!);
    expect(reparsed.logistics_address).not.toHaveProperty('address2');
  });

  it('drops empty optional fields (phone_country) when null', () => {
    const cmd = buildAliExpressPlaceOrderCommand({
      ...baseResolved,
      shippingAddress: { ...address, phoneCountry: null }
    });
    const params = cmd.toBizParams();
    const reparsed: {
      logistics_address: Record<string, unknown>;
    } = JSON.parse(params['param_place_order_request4']!);
    expect(reparsed.logistics_address).not.toHaveProperty('phone_country');
  });

  it('supports multiple line items', () => {
    const cmd = buildAliExpressPlaceOrderCommand({
      ...baseResolved,
      items: [
        baseResolved.items[0]!,
        {
          aliexpressProductId: '999999',
          skuAttr: null,
          logisticsServiceName: null,
          quantity: 1
        }
      ]
    });
    expect(cmd.body.param_place_order_request4.product_items).toHaveLength(2);
    expect(cmd.body.param_place_order_request4.product_items[1]?.sku_attr).toBeUndefined();
    expect(
      cmd.body.param_place_order_request4.product_items[1]?.logistics_service_name
    ).toBeUndefined();
  });

  it('throws when no items are provided', () => {
    expect(() =>
      buildAliExpressPlaceOrderCommand({ ...baseResolved, items: [] })
    ).toThrow(/at least one item/i);
  });

  it('throws when shipping address is null', () => {
    expect(() =>
      buildAliExpressPlaceOrderCommand({ ...baseResolved, shippingAddress: null })
    ).toThrow(/shipping address/i);
  });
});
