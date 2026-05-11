import { describe, expect, it, vi } from 'vitest';

/**
 * This test verifies that ALIEXPRESS_MIN_RELEVANCE overrides the default adaptive threshold,
 * allowing noisy Amazon-ish keywords to return some candidates.
 */
describe('AliExpress min relevance override', () => {
  it('passes candidates when override is lower than default', async () => {
    vi.resetModules();

    // Override env for this test.
    vi.doMock('../../src/config/env', () => ({
      env: {
        ALIEXPRESS_APP_KEY: 'TESTKEY',
        ALIEXPRESS_APP_SECRET: 'TESTSECRET',
        ALIEXPRESS_TRACKING_ID: 'TESTTRACK',
        ALIEXPRESS_MIN_RELEVANCE: 0.05
      }
    }));

    // Mock session + signing internals used by aeCall.
    vi.doMock('../../src/modules/researcher/aliexpress.session', () => ({
      getFreshAliExpressSession: vi.fn(async () => 'SESSION')
    }));
    vi.doMock('../../src/modules/researcher/aliexpress.oauth', () => ({
      signAliExpressParams: vi.fn(() => 'SIGN')
    }));

    // Mock API responses:
    // - feedname.get returns a non-empty list of feeds
    // - recommend.feed.get returns 20 items where title relevance is low but non-zero
    vi.doMock('axios', () => ({
      default: {
        post: vi.fn(async (_url: string, body: unknown) => {
          const params = body as URLSearchParams;
          const method = params.get('method');
          if (method === 'aliexpress.ds.feedname.get') {
            return {
              status: 200,
              data: {
                resp_result: [{ promo_name: 'USA_beauty&health_topsellers' }],
                rsp_code: 200
              }
            };
          }

          if (method === 'aliexpress.ds.recommend.feed.get') {
            return {
              status: 200,
              data: {
                result: {
                  products: Array.from({ length: 20 }).map((_, i) => ({
                    product_id: String(1000 + i),
                    product_title: `multi stick travel creami ${i}`,
                    product_detail_url: `https://www.aliexpress.com/item/${1000 + i}.html`,
                    sale_price: '9.99',
                    original_price: '12.99',
                    discount: '0',
                    score: '0',
                    lastest_volume: '0',
                    avg_evaluate_rate: '4.7',
                    evaluate_rate: '4.7',
                    review_count: '10',
                    product_main_image_url: 'https://example.com/img.jpg',
                    product_small_image_urls: 'https://example.com/img.jpg'
                  }))
                },
                rsp_code: 200
              }
            };
          }

          if (method === 'aliexpress.ds.product.get') {
            return {
              status: 200,
              data: {
                result: {
                  ae_item_base_info_dto: {
                    image_urls: 'https://example.com/a.jpg,https://example.com/b.jpg'
                  }
                },
                rsp_code: 200
              }
            };
          }

          throw new Error(`unexpected method ${method ?? ''}`);
        })
      }
    }));

    const { searchAliExpress } = await import('../../src/modules/researcher/aliexpress');
    const out = await searchAliExpress('multi stick travel- creami');
    expect(out.length).toBeGreaterThan(0);
  });
});

