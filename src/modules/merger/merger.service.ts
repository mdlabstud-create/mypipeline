import { env } from '../../config/env';
import { query } from '../../config/db';
import { logPipelineEvent } from '../../shared/logger';
import { mergeAndScore } from './merger.logic';

type TrendingRow = {
  id: string;
  keyword: string;
  source: 'tiktok' | 'amazon' | 'both';
  tiktok_score: number | null;
  amazon_score: number | null;
  tiktok_retail_usd: number | null;
};

/**
 * Runs dedup + scoring across recent trending products.
 *
 * @returns list of productIds that passed the threshold
 */
export async function runMerger(): Promise<string[]> {
  const rows = await query<TrendingRow>(
    `SELECT id, keyword, source, tiktok_score, amazon_score,
            tiktok_retail_usd::float8 AS tiktok_retail_usd
     FROM trending_products
     WHERE created_at > now() - ($1::int * interval '1 day')
       AND status = 'pending_research'`,
    [env.MERGER_LOOKBACK_DAYS]
  );

  const groups = new Map<string, TrendingRow[]>();
  for (const r of rows) {
    const key = r.keyword.trim().toLowerCase();
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  /** Candidates that crossed the merger threshold ({@link mergeAndScore}). */
  const passed: Array<{ id: string; trendScore: number }> = [];
  let mergedCount = 0;

  for (const [normKeyword, group] of groups.entries()) {
    const keep = group[0];
    if (!keep) continue;

    const tiktokScore =
      group.find((g) => g.source === 'tiktok' || g.source === 'both')?.tiktok_score ??
      null;
    const amazonScore =
      group.find((g) => g.source === 'amazon' || g.source === 'both')?.amazon_score ??
      null;

    const result = mergeAndScore({
      keyword: normKeyword,
      tiktokScore,
      amazonScore,
      threshold: env.TREND_SCORE_THRESHOLD
    });

    const mergedTiktokRetail = group.reduce<number | null>((acc, g) => {
      const v = g.tiktok_retail_usd;
      if (v == null || !Number.isFinite(v)) return acc;
      if (acc == null || v > acc) return v;
      return acc;
    }, null);

    await query(
      `UPDATE trending_products
       SET keyword = $2,
           source = $3,
           trend_score = $4,
           status = $5,
           tiktok_retail_usd = COALESCE($6::numeric, tiktok_retail_usd)
       WHERE id = $1`,
      [
        keep.id,
        result.keyword,
        result.source,
        result.trendScore,
        result.status,
        mergedTiktokRetail
      ]
    );

    const extraIds = group.slice(1).map((g) => g.id);
    if (extraIds.length > 0) {
      await query('DELETE FROM trending_products WHERE id = ANY($1::uuid[])', [
        extraIds
      ]);
      mergedCount += extraIds.length;
    }

    if (result.status === 'pending_research') {
      passed.push({ id: keep.id, trendScore: result.trendScore });
    }
  }

  passed.sort((a, b) => b.trendScore - a.trendScore);

  const cap = env.MERGER_MAX_RESEARCH_PER_RUN;
  const tier1 =
    cap > 0 && passed.length > cap ? passed.slice(0, cap).map((p) => p.id) : passed.map((p) => p.id);
  /** Offer extra high-scoring IDs so the merger worker can skip products that already have listings and still fill `cap` jobs. */
  const poolLimit = cap > 0 ? Math.min(passed.length, cap * 40) : passed.length;
  const capped = passed.slice(0, poolLimit).map((p) => p.id);

  const belowCapIds =
    cap > 0 && passed.length > cap ? passed.slice(cap).map((p) => p.id) : [];

  if (belowCapIds.length > 0 && env.MERGER_REJECT_NON_CAP_RUN) {
    await query(
      `UPDATE trending_products SET status = 'rejected' WHERE id = ANY($1::uuid[])`,
      [belowCapIds]
    );
  }

  await logPipelineEvent({
    stage: 'merger',
    status: 'ok',
    message: 'merger completed',
    payload: {
      inputRows: rows.length,
      mergedDuplicates: mergedCount,
      passed: passed.length,
      researchPool: capped.length,
      tier1EnqueueHint: tier1.length,
      rejectedBelowCap:
        env.MERGER_REJECT_NON_CAP_RUN && belowCapIds.length > 0 ? belowCapIds.length : 0
    }
  });

  return capped;
}