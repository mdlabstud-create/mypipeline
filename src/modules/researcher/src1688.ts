import axios from 'axios';
import { chromium, type Browser } from 'playwright';
import { env } from '../../config/env';
import redisClient from '../../config/redis';
import logger from '../../shared/logger';
import type { SupplierCandidate } from '../../shared/types';
import { ScraperError } from '../../shared/errors';

/**
 * Converts a CNY amount to USD given a rate and rounds to 2 decimals.
 */
export function convertCnyToUsd(priceCny: number, cnyToUsdRate: number): number {
  const usd = priceCny * cnyToUsdRate;
  return Math.round(usd * 100) / 100;
}

function parseCnyPrice(text: string): number | null {
  // Examples: "¥12.50", "￥35", "12.50"
  const cleaned = text.replace(/,/g, ' ').replace(/[¥￥]/g, ' ');
  const m = cleaned.match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

async function getCnyToUsdRate(): Promise<number> {
  const cacheKey = 'fx:CNYUSD';
  const cached = await redisClient.get(cacheKey);
  if (cached) {
    const n = Number(cached);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const url = `https://v6.exchangerate-api.com/v6/${env.EXCHANGE_RATE_API_KEY}/pair/CNY/USD`;
  const res = await axios.get(url, { timeout: 20_000 });
  const rateRaw = (res.data as unknown as { conversion_rate?: unknown }).conversion_rate;
  const rate = typeof rateRaw === 'number' ? rateRaw : Number(rateRaw);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Invalid exchange rate response');
  }

  await redisClient.set(cacheKey, String(rate), 'EX', 3600);
  return rate;
}

/**
 * Searches 1688.com for suppliers matching a keyword.
 */
export async function search1688(keyword: string): Promise<SupplierCandidate[]> {
  const proxy = {
    server: env.WEBSHARE_PROXY_SERVER,
    username: env.WEBSHARE_PROXY_USERNAME,
    password: env.WEBSHARE_PROXY_PASSWORD
  };

  const rate = await getCnyToUsdRate();
  const url = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}`;

  let browser: Browser | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      browser = await chromium.launch({ headless: true, proxy });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      const title = (await page.title()).toLowerCase();
      const currentUrl = page.url().toLowerCase();
      if (title.includes('captcha') || currentUrl.includes('captcha') || currentUrl.includes('robot')) {
        throw new ScraperError('1688 CAPTCHA detected', '1688', true);
      }

      // Try both selectors mentioned in spec
      const listSel = page.locator('.sm-offer-item');
      const altSel = page.locator('.offer-list-row');
      const countA = await listSel.count();
      const cards = countA > 0 ? listSel : altSel;

      const count = Math.min(await cards.count(), 10);
      const out: SupplierCandidate[] = [];

      for (let i = 0; i < count; i += 1) {
        const card = cards.nth(i);
        const href =
          (await card.locator('a').first().getAttribute('href'))?.trim() ?? '';
        const titleText =
          (await card.locator('[title]').first().getAttribute('title')) ??
          (await card.locator('a').first().textContent()) ??
          '';
        const titleClean = titleText.replace(/\s+/g, ' ').trim();

        const priceText =
          (await card.locator('[class*=price]').first().textContent()) ??
          (await card.locator('.price, .price-now, .price-num').first().textContent()) ??
          '';
        const moqText =
          (await card.locator('[class*=moq]').first().textContent()) ??
          (await card.locator('[class*=amount]').first().textContent()) ??
          '';
        const img =
          (await card.locator('img').first().getAttribute('src'))?.trim() ?? '';

        const priceCny = parseCnyPrice(priceText);
        if (priceCny === null) continue;
        const priceUsd = convertCnyToUsd(priceCny, rate);

        const moqMatch = moqText.match(/(\d+)/);
        const moq = moqMatch ? Number(moqMatch[1]) : 1;

        out.push({
          platform: '1688',
          supplierUrl: href.startsWith('http') ? href : href ? `https:${href}` : '',
          productTitle: titleClean.length > 0 ? titleClean : null,
          priceUsd,
          priceCny,
          moq: Number.isFinite(moq) && moq > 0 ? moq : 1,
          rating: null,
          reviewCount: 0,
          shippingDays: 25,
          fastShip: false,
          images: img ? [img.startsWith('http') ? img : `https:${img}`] : []
        });
      }

      await page.close();
      await browser.close();
      return out.filter((s) => s.supplierUrl.length > 0);
    } catch (err) {
      if (browser) {
        await browser.close();
        browser = null;
      }
      logger.warn('1688 search attempt failed', { attempt, keyword, error: String(err) });
      const wait = 2 ** attempt * 1000;
      await new Promise((r) => setTimeout(r, wait));
      if (attempt === 3) {
        throw new ScraperError('1688 search failed', '1688', false);
      }
    }
  }

  return [];
}
