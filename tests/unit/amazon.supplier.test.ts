import { describe, expect, it } from 'vitest';
import { parseAmazonSearchResult } from '../../src/modules/researcher/researcher.service';

describe('parseAmazonSearchResult', () => {
  it('parses a Scrapingdog `products[]` payload (happy path)', () => {
    const raw = {
      products: [
        {
          title: 'Wireless Earbuds Pro',
          price: 24.99,
          image: 'https://m.media-amazon.com/images/I/abc.jpg',
          url: 'https://www.amazon.com/dp/B0EXAMPLE'
        }
      ]
    };

    const out = parseAmazonSearchResult(raw, null);
    expect(out).not.toBeNull();
    expect(out?.platform).toBe('amazon');
    expect(out?.supplierUrl).toBe('https://www.amazon.com/dp/B0EXAMPLE');
    expect(out?.productTitle).toBe('Wireless Earbuds Pro');
    expect(out?.priceUsd).toBe(24.99);
    expect(out?.images).toEqual(['https://m.media-amazon.com/images/I/abc.jpg']);
    expect(out?.shippingDays).toBe(5);
    expect(out?.fastShip).toBe(true);
    expect(out?.moq).toBe(1);
  });

  it('falls back to the `results[]` wrapping variant', () => {
    const raw = {
      results: [
        { title: 't', price: 10, image: 'https://x/y.jpg', url: 'https://a/b' }
      ]
    };
    const out = parseAmazonSearchResult(raw, null);
    expect(out?.priceUsd).toBe(10);
  });

  it('uses `imageUrl` when `image` is missing, and `link` when `url` is missing', () => {
    const raw = {
      products: [
        { title: 't', price: 7, imageUrl: 'https://x/img.jpg', link: 'https://a/p/123' }
      ]
    };
    const out = parseAmazonSearchResult(raw, null);
    expect(out?.images).toEqual(['https://x/img.jpg']);
    expect(out?.supplierUrl).toBe('https://a/p/123');
  });

  it('coerces a numeric-string price', () => {
    const raw = { products: [{ title: 't', price: '$15.50', url: 'https://a/p' }] };
    const out = parseAmazonSearchResult(raw, null);
    expect(out?.priceUsd).toBe(15.5);
  });

  it('returns null when price is missing or invalid', () => {
    const raw = { products: [{ title: 't', url: 'https://a/p' }] };
    expect(parseAmazonSearchResult(raw, null)).toBeNull();
    expect(parseAmazonSearchResult({ products: [{ title: 't', price: 'free', url: 'https://a/p' }] }, null)).toBeNull();
  });

  it('prefers a preferUrl built from a known ASIN over the response URL', () => {
    const raw = {
      products: [{ title: 't', price: 10, url: 'https://www.amazon.com/different' }]
    };
    const out = parseAmazonSearchResult(raw, 'https://www.amazon.com/dp/B0PREFER');
    expect(out?.supplierUrl).toBe('https://www.amazon.com/dp/B0PREFER');
  });

  it('returns null when there is no usable URL (no preferUrl AND no url/link in response)', () => {
    const raw = { products: [{ title: 't', price: 10 }] };
    expect(parseAmazonSearchResult(raw, null)).toBeNull();
  });

  it('returns null on empty/missing list', () => {
    expect(parseAmazonSearchResult({ products: [] }, null)).toBeNull();
    expect(parseAmazonSearchResult({}, null)).toBeNull();
    expect(parseAmazonSearchResult(null, null)).toBeNull();
    expect(parseAmazonSearchResult('garbage', null)).toBeNull();
  });

  it('skips non-object items in the list', () => {
    const raw = {
      products: [
        null,
        'string',
        42,
        { title: 't', price: 10, url: 'https://a/p' }
      ]
    };
    const out = parseAmazonSearchResult(raw, null);
    expect(out?.supplierUrl).toBe('https://a/p');
  });

  it('returns null images when no image field is present (not a malformed array)', () => {
    const raw = { products: [{ title: 't', price: 10, url: 'https://a/p' }] };
    const out = parseAmazonSearchResult(raw, null);
    expect(out?.images).toEqual([]);
  });
});
