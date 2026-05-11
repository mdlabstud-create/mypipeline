import { chromium, type Browser } from 'playwright';
import { env } from '../../config/env';
import logger from '../../shared/logger';
import type { SupplierCandidate } from '../../shared/types';
import { ScraperError } from '../../shared/errors';

function parseUsdPrice(value: string): number | null {
  // Examples: "US$ 2.50 - 5.00", "US$2.50", "$2.50"
  const cleaned = value.replace(/,/g, ' ');
  const matches = cleaned.match(/(\d+(\.\d+)?)/g);
  if (!matches || matches.length === 0) return null;
  const nums = matches.map((m) => Number(m)).filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;
  return Math.min(...nums);
}

function parseMoq(value: string): number {
  const m = value.match(/(\d+)/);
  if (!m) return 1;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Searches Alibaba for suppliers matching a keyword.
 */
export async function searchAlibaba(keyword: string): Promise<SupplierCandidate[]> {
  const proxy = {
    server: env.WEBSHARE_PROXY_SERVER,
    username: env.WEBSHARE_PROXY_USERNAME,
    password: env.WEBSHARE_PROXY_PASSWORD
  };

  const url = `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(keyword)}`;

  let browser: Browser | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      browser = await chromium.launch({ headless: true, proxy });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      const title = (await page.title()).toLowerCase();
      const currentUrl = page.url().toLowerCase();
      if (title.includes('captcha') || currentUrl.includes('captcha') || currentUrl.includes('robot')) {
        throw new ScraperError('Alibaba CAPTCHA detected', 'alibaba', true);
      }

      await page.waitForSelector('.search-card-e-slider__main', { timeout: 45_000 });

      const out: SupplierCandidate[] = [];
      const cards = page.locator('.search-card-e-slider__main');
      const count = Math.min(await cards.count(), 10);

      for (let i = 0; i < count; i += 1) {
        const card = cards.nth(i);
        const href =
          (await card.locator('a').first().getAttribute('href'))?.trim() ?? '';
        if (!href) continue;

        const titleText =
          (await card.locator('h2').first().textContent()) ??
          (await card.locator('[title]').first().getAttribute('title')) ??
          (await card.locator('a').first().textContent()) ??
          '';
        const titleClean = titleText.replace(/\s+/g, ' ').trim();

        const priceText =
          (await card.locator('[class*=price]').first().textContent()) ?? '';
        const moqText =
          (await card.locator('[class*=moq]').first().textContent()) ?? '';
        const img =
          (await card.locator('img').first().getAttribute('src'))?.trim() ?? '';

        const priceUsd = parseUsdPrice(priceText) ?? 9999;
        const moq = moqText ? parseMoq(moqText) : 1;

        out.push({
          platform: 'alibaba',
          supplierUrl: href,
          productTitle: titleClean.length > 0 ? titleClean : null,
          priceUsd,
          priceCny: null,
          moq,
          rating: null,
          reviewCount: 0,
          shippingDays: 21,
          fastShip: false,
          images: img ? [img] : []
        });
      }

      await page.close();
      await browser.close();
      return out;
    } catch (err) {
      if (browser) {
        await browser.close();
        browser = null;
      }

      logger.warn('alibaba search attempt failed', { attempt, keyword, error: String(err) });

      const wait = 2 ** attempt * 1000;
      await new Promise((r) => setTimeout(r, wait));

      if (attempt === 3) {
        throw new ScraperError('Alibaba search failed', 'alibaba', false);
      }
    }
  }

  return [];
}
