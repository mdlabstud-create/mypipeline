import { describe, expect, it } from 'vitest';
import { parseAliExpressFeedResponse } from '../../src/modules/researcher/aliexpress';

/**
 * Builds a single AE-Dropshipper feed product row in the shape returned by
 * api-sg.aliexpress.com → aliexpress.ds.recommend.feed.get.
 */
function feedProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product_id: 1005006789012345,
    product_title: 'Wireless Bluetooth Earbuds Pro',
    product_detail_url: 'https://www.aliexpress.com/item/1005006789012345.html',
    sale_price: '12.34',
    target_sale_price: '11.99',
    ship_to_days: '7',
    evaluate_rate: '80%',
    evaluation_count: '120',
    product_main_image_url: 'https://ae01.alicdn.com/main.jpg',
    product_small_image_urls: {
      string: ['https://ae01.alicdn.com/a.jpg', 'https://ae01.alicdn.com/b.jpg']
    },
    ...overrides
  };
}

describe('parseAliExpressFeedResponse', () => {
  it('parses the new flat api-sg shape with products[]', () => {
    const raw = {
      result: { products: [feedProduct()] },
      rsp_code: 200
    };

    const out = parseAliExpressFeedResponse(raw);

    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.platform).toBe('aliexpress');
    expect(c.productTitle).toBe('Wireless Bluetooth Earbuds Pro');
    expect(c.priceUsd).toBe(11.99); // prefers target_sale_price over sale_price
    expect(c.shippingDays).toBe(7);
    expect(c.fastShip).toBe(true);
    expect(c.rating).toBe(4); // 80% / 20 = 4.0/5
    expect(c.reviewCount).toBe(120);
    expect(c.moq).toBe(1);
    expect(c.priceCny).toBeNull();
    expect(c.supplierUrl).toBe(
      'https://www.aliexpress.com/item/1005006789012345.html#ae_pid=1005006789012345'
    );
    expect(c.images).toEqual([
      'https://ae01.alicdn.com/main.jpg',
      'https://ae01.alicdn.com/a.jpg',
      'https://ae01.alicdn.com/b.jpg'
    ]);
  });

  it('parses the legacy wrapped shape (aliexpress_ds_recommend_feed_get_response)', () => {
    const raw = {
      aliexpress_ds_recommend_feed_get_response: {
        result: { products: [feedProduct()] }
      }
    };

    const out = parseAliExpressFeedResponse(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.platform).toBe('aliexpress');
  });

  it('parses the products.integer wrapping variant', () => {
    const raw = {
      result: { products: { integer: [feedProduct()] } }
    };

    const out = parseAliExpressFeedResponse(raw);
    expect(out).toHaveLength(1);
  });

  it('parses the products.traffic_product_d_t_o wrapping variant', () => {
    const raw = {
      result: { products: { traffic_product_d_t_o: [feedProduct()] } }
    };

    const out = parseAliExpressFeedResponse(raw);
    expect(out).toHaveLength(1);
  });

  it('returns [] when raw is not an object', () => {
    expect(parseAliExpressFeedResponse(null)).toEqual([]);
    expect(parseAliExpressFeedResponse('oops')).toEqual([]);
    expect(parseAliExpressFeedResponse(42)).toEqual([]);
  });

  it('returns [] when error_response is present', () => {
    const raw = {
      error_response: { code: '50001', msg: 'something broke' },
      result: { products: [feedProduct()] }
    };
    expect(parseAliExpressFeedResponse(raw)).toEqual([]);
  });

  it('returns [] when result is missing', () => {
    expect(parseAliExpressFeedResponse({})).toEqual([]);
    expect(parseAliExpressFeedResponse({ result: null })).toEqual([]);
  });

  it('returns [] when products list is empty', () => {
    expect(parseAliExpressFeedResponse({ result: { products: [] } })).toEqual([]);
  });

  it('skips items missing product_detail_url or price', () => {
    const raw = {
      result: {
        products: [
          feedProduct({ product_detail_url: undefined }),
          feedProduct({ sale_price: undefined, target_sale_price: undefined }),
          feedProduct() // valid one
        ]
      }
    };
    expect(parseAliExpressFeedResponse(raw)).toHaveLength(1);
  });

  it('falls back to sale_price when target_sale_price is absent', () => {
    const raw = {
      result: {
        products: [feedProduct({ target_sale_price: undefined, sale_price: '7.50' })]
      }
    };
    const out = parseAliExpressFeedResponse(raw);
    expect(out[0]?.priceUsd).toBe(7.5);
  });

  it('marks fastShip=false when shipping > 14 days', () => {
    const raw = { result: { products: [feedProduct({ ship_to_days: '21' })] } };
    expect(parseAliExpressFeedResponse(raw)[0]?.fastShip).toBe(false);
  });

  it('marks fastShip=null when shipping is missing', () => {
    const raw = { result: { products: [feedProduct({ ship_to_days: undefined })] } };
    const c = parseAliExpressFeedResponse(raw)[0];
    expect(c?.shippingDays).toBeNull();
    expect(c?.fastShip).toBeNull();
  });

  it('falls back to url-only supplierUrl when product_id is missing', () => {
    const raw = {
      result: {
        products: [
          feedProduct({
            product_id: undefined,
            product_detail_url: 'https://www.aliexpress.com/item/x.html'
          })
        ]
      }
    };
    const c = parseAliExpressFeedResponse(raw)[0];
    expect(c?.supplierUrl).toBe('https://www.aliexpress.com/item/x.html');
  });

  it('handles small_image_urls as a comma/semicolon-delimited string', () => {
    const raw = {
      result: {
        products: [
          feedProduct({
            product_small_image_urls:
              'https://ae01.alicdn.com/a.jpg,https://ae01.alicdn.com/b.jpg'
          })
        ]
      }
    };
    const imgs = parseAliExpressFeedResponse(raw)[0]?.images ?? [];
    expect(imgs).toContain('https://ae01.alicdn.com/a.jpg');
    expect(imgs).toContain('https://ae01.alicdn.com/b.jpg');
  });

  it('caps images at 10', () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://ae01.alicdn.com/${i}.jpg`);
    const raw = {
      result: {
        products: [feedProduct({ product_small_image_urls: { string: many } })]
      }
    };
    expect(parseAliExpressFeedResponse(raw)[0]?.images).toHaveLength(10);
  });
});
