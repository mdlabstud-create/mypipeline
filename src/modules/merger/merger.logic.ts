import type { TrendingProductSource, TrendingProductStatus } from '../../shared/types';

/**
 * Result of merging/scoring a keyword across sources.
 */
export interface MergeScoreResult {
  keyword: string;
  source: TrendingProductSource;
  trendScore: number;
  status: TrendingProductStatus;
}

/**
 * Pure merge+score function for Phase 1.
 */
export function mergeAndScore(params: {
  keyword: string;
  tiktokScore?: number | null;
  amazonScore?: number | null;
  threshold: number;
}): MergeScoreResult {
  const tiktok = params.tiktokScore ?? 0;
  const amazon = params.amazonScore ?? 0;
  const hasTiktok = (params.tiktokScore ?? null) !== null && tiktok > 0;
  const hasAmazon = (params.amazonScore ?? null) !== null && amazon > 0;

  const source: TrendingProductSource = hasTiktok && hasAmazon ? 'both' : hasTiktok ? 'tiktok' : 'amazon';
  const crossSourceBonus = source === 'both' ? 0.2 : 0;

  // If TikTok is unavailable (quota issues) but Amazon data exists, Amazon should still drive a meaningful score.
  // Previous weighting (`0.5*tiktok + 0.3*amazon`) effectively zeroed Amazon-only runs.
  const baseScore =
    hasTiktok && hasAmazon ? tiktok * 0.5 + amazon * 0.3 : hasAmazon ? amazon : hasTiktok ? tiktok : 0;

  const trendScore = Math.min(Math.max(baseScore + crossSourceBonus, 0), 1);
  const status: TrendingProductStatus =
    trendScore >= params.threshold ? 'pending_research' : 'rejected';

  return { keyword: params.keyword, source, trendScore, status };
}

