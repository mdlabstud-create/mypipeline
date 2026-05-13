import axios from 'axios';
import { query } from '../../config/db';
import { env } from '../../config/env';
import { logPipelineEvent } from '../../shared/logger';
import type { ViabilityBreakdown } from '../../shared/types';

interface TrendingRow {
  keyword: string;
  tiktok_score: number | null;
  amazon_retail_usd: number | null;
}

// ---------- margin scoring ----------

function scoreMargin(marginPct: number): number {
  if (marginPct >= 40) return 10;
  if (marginPct >= 30) return 7;
  if (marginPct >= 20) return 4;
  return 0;
}

function estimateMarginPct(amazonRetailUsd: number | null, supplierPriceUsd: number | null): number {
  if (supplierPriceUsd != null && amazonRetailUsd != null && amazonRetailUsd > 0) {
    return ((amazonRetailUsd - supplierPriceUsd) / amazonRetailUsd) * 100;
  }
  if (amazonRetailUsd != null && amazonRetailUsd > 0) {
    // conservative: assume COGS = 30% of retail
    const estimatedCogs = amazonRetailUsd * 0.30;
    return ((amazonRetailUsd - estimatedCogs) / amazonRetailUsd) * 100;
  }
  // no anchor: assume a middling 30% margin
  return 30;
}

// ---------- competition density ----------

async function fetchCompetitionCount(keyword: string): Promise<number | null> {
  try {
    const res = await axios.get('https://api.scrapingdog.com/google', {
      params: {
        api_key: env.SCRAPINGDOG_API_KEY,
        query: `site:myshopify.com "${keyword}"`,
        results: 10
      },
      timeout: 15_000
    });
    const data = res.data as Record<string, unknown>;
    // Scrapingdog returns total_results in the meta object
    const meta = data['meta'] as Record<string, unknown> | undefined;
    const total =
      typeof meta?.['total_results'] === 'number'
        ? meta['total_results']
        : typeof data['total_results'] === 'number'
          ? (data['total_results'] as number)
          : null;
    return total;
  } catch {
    return null;
  }
}

function scoreCompetition(count: number | null): number {
  if (count === null) return 5; // neutral when unavailable
  if (count <= 5) return 10;
  if (count <= 15) return 7;
  if (count <= 30) return 4;
  return 0;
}

// ---------- Google Trends demand ----------

async function fetchGoogleTrendsDemand(keyword: string): Promise<number | null> {
  try {
    const exploreRes = await axios.get('https://trends.google.com/trends/api/explore', {
      params: {
        hl: 'en-US',
        tz: '0',
        req: JSON.stringify({
          comparisonItem: [{ keyword, geo: '', time: 'today 12-m' }],
          category: 0,
          property: ''
        })
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; dropship-pipeline/1.0)'
      },
      timeout: 15_000
    });

    // Response starts with ")]}'\n" — strip that prefix
    const raw = typeof exploreRes.data === 'string' ? exploreRes.data : JSON.stringify(exploreRes.data);
    const json = raw.replace(/^\)\]\}'\n/, '');
    const parsed = JSON.parse(json) as { widgets?: Array<{ id?: string; token?: string }> };
    const widget = parsed.widgets?.find((w) => w.id === 'TIMESERIES');
    if (!widget?.token) return null;

    const timelineRes = await axios.get('https://trends.google.com/trends/api/widgetdata/multiline', {
      params: {
        hl: 'en-US',
        tz: '0',
        req: JSON.stringify({ time: 'today 12-m', resolution: 'MONTH', locale: 'en-US', comparisonItem: [{ geo: {}, complexKeywordsRestriction: { keyword: [{ type: 'BROAD', value: keyword }] } }], requestOptions: { property: '', backend: 'IZG', category: 0 } }),
        token: widget.token
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; dropship-pipeline/1.0)'
      },
      timeout: 15_000
    });

    const raw2 = typeof timelineRes.data === 'string' ? timelineRes.data : JSON.stringify(timelineRes.data);
    const json2 = raw2.replace(/^\)\]\}'\n/, '');
    const parsed2 = JSON.parse(json2) as { default?: { timelineData?: Array<{ value?: number[] }> } };
    const timeline = parsed2.default?.timelineData ?? [];
    const values = timeline.map((t) => t.value?.[0] ?? 0).filter((v) => v > 0);
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  } catch {
    return null;
  }
}

function scoreDemand(avg: number | null): number {
  if (avg === null) return 5; // neutral when unavailable
  if (avg >= 60) return 10;
  if (avg >= 40) return 7;
  if (avg >= 20) return 4;
  return 0;
}

function isDemandDying(avg: number | null): boolean {
  // We don't have the last-3-months slice easily without another API call — use avg as proxy
  return avg !== null && avg < 15;
}

// ---------- WOW factor ----------

function scoreWow(tiktokScore: number | null): number {
  if (tiktokScore === null) return 5;
  // tiktok_score is stored as 0..1 float; normalise to 0..10
  return Math.min(10, Math.max(0, tiktokScore * 10));
}

// ---------- main scorer ----------

export async function scoreProductViability(productId: string): Promise<void> {
  const rows = await query<TrendingRow>(
    `SELECT keyword, tiktok_score::float8 AS tiktok_score,
            amazon_retail_usd::float8 AS amazon_retail_usd
     FROM trending_products WHERE id = $1 LIMIT 1`,
    [productId]
  );
  const product = rows[0];
  if (!product) return;

  // Get cheapest known supplier price (may not exist yet at this stage)
  const supplierRows = await query<{ price_usd: number }>(
    'SELECT price_usd::float8 AS price_usd FROM suppliers WHERE product_id = $1 ORDER BY price_usd ASC LIMIT 1',
    [productId]
  );
  const supplierPrice = supplierRows[0]?.price_usd ?? null;

  const estimatedMarginPct = estimateMarginPct(product.amazon_retail_usd, supplierPrice);
  const competingStores = await fetchCompetitionCount(product.keyword);
  const demandAvg = await fetchGoogleTrendsDemand(product.keyword);

  const marginScore = scoreMargin(estimatedMarginPct);
  const competitionScore = scoreCompetition(competingStores);
  const demandScore = scoreDemand(demandAvg);
  const wowScore = scoreWow(product.tiktok_score);

  const viabilityScore =
    marginScore * 0.35 +
    competitionScore * 0.25 +
    demandScore * 0.25 +
    wowScore * 0.15;

  // Hard reject checks
  let hardReject: string | null = null;
  if (estimatedMarginPct < env.VIABILITY_MIN_MARGIN_PCT) {
    hardReject = `margin_too_low:${estimatedMarginPct.toFixed(1)}%`;
  } else if (competingStores !== null && competingStores > env.VIABILITY_COMPETITION_MAX) {
    hardReject = `too_many_competitors:${competingStores}`;
  } else if (isDemandDying(demandAvg)) {
    hardReject = `dying_trend:avg=${demandAvg?.toFixed(1)}`;
  }

  let viabilityStatus: 'viable' | 'marginal' | 'rejected';
  if (hardReject !== null || viabilityScore < env.VIABILITY_MARGINAL_SCORE) {
    viabilityStatus = 'rejected';
  } else if (viabilityScore < env.VIABILITY_MIN_SCORE) {
    viabilityStatus = 'marginal';
  } else {
    viabilityStatus = 'viable';
  }

  const breakdown: ViabilityBreakdown = {
    marginScore,
    competitionScore,
    demandScore,
    wowScore,
    estimatedMarginPct,
    competingStores,
    demandAverage: demandAvg,
    hardReject
  };

  await query(
    `UPDATE trending_products
     SET viability_score = $2,
         viability_breakdown = $3,
         viability_status = $4,
         viability_checked_at = now()
     WHERE id = $1`,
    [productId, viabilityScore.toFixed(2), JSON.stringify(breakdown), viabilityStatus]
  );

  await logPipelineEvent({
    stage: 'viability-scorer',
    status: viabilityStatus === 'rejected' ? 'warn' : 'ok',
    message: `viability scored: ${viabilityStatus}`,
    productId,
    payload: { viabilityScore: viabilityScore.toFixed(2), viabilityStatus, hardReject, breakdown }
  });
}
