import nlp from 'compromise';
import { PorterStemmer } from 'natural';
import type { AmazonRawProduct } from '../../shared/types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parses raw Scrapingdog response into typed Amazon products.
 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^\d.]+/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseAmazonItems(raw: unknown): AmazonRawProduct[] {
  if (!isObject(raw)) return [];
  const items = raw['products'] ?? raw['results'];
  if (!Array.isArray(items)) return [];

  const out: AmazonRawProduct[] = [];
  for (const it of items) {
    if (!isObject(it)) continue;
    const asin = it['asin'];
    const title = it['title'];
    const bsrRaw =
      it['bestSellerRank'] ??
      it['bsr'] ??
      it['rank'] ??
      // Scrapingdog amazon/search uses positions; lower is better.
      it['organic_position'] ??
      it['absolute_position'];
    const bsr = toFiniteNumber(bsrRaw);
    if (typeof asin !== 'string' || typeof title !== 'string' || bsr === null) {
      continue;
    }
    const priceRaw = it['price'];
    const price =
      typeof priceRaw === 'number' && Number.isFinite(priceRaw)
        ? priceRaw
        : toFiniteNumber(priceRaw);

    out.push({
      asin,
      title,
      bestSellerRank: bsr,
      imageUrl: typeof it['imageUrl'] === 'string' ? it['imageUrl'] : null,
      price,
      rating: typeof it['rating'] === 'number' ? it['rating'] : null,
      reviewCount: typeof it['reviewCount'] === 'number' ? it['reviewCount'] : null
    });
  }
  return out;
}

/**
 * Normalizes an Amazon product title into a keyword phrase.
 */
export function normalizeAmazonKeyword(title: string): string {
  const cleaned = title.replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const withoutBrand = cleaned.split(' ').slice(1).join(' ').trim();
  const doc = nlp(withoutBrand.length > 0 ? withoutBrand : cleaned);
  const nounPhrases = doc.nouns().out('array') as string[];

  const tokens = (nounPhrases.length > 0 ? nounPhrases : [withoutBrand])
    .join(' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .map((t) => PorterStemmer.stem(t));

  return tokens.slice(0, 4).join(' ').trim();
}

/**
 * Calculates normalized Amazon score from BSR (lower is better).
 */
export function calculateAmazonScore(bsr: number, maxBsr: number): number {
  if (!Number.isFinite(bsr) || !Number.isFinite(maxBsr) || maxBsr <= 0) return 0;
  const score = 1 - bsr / maxBsr;
  return Math.min(Math.max(score, 0), 1);
}