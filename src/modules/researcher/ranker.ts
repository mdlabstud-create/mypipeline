import type { SupplierCandidate } from '../../shared/types';
import type { SlaStatus } from '../../shared/types';

function normHigherIsBetter(values: number[]): (v: number) => number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const denom = max - min;
  if (denom === 0) return () => 1;
  return (v: number) => (v - min) / denom;
}

function normLowerIsBetter(values: number[]): (v: number) => number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const denom = max - min;
  if (denom === 0) return () => 1;
  return (v: number) => (max - v) / denom;
}

/**
 * Classifies supplier SLA based on shipping_days_max.
 * Uses shippingDays as the max estimate when no explicit max is available.
 */
export function classifySla(shippingDays: number | null | undefined): SlaStatus {
  if (shippingDays == null) return 'unknown';
  if (shippingDays <= 10) return 'fast';
  if (shippingDays <= 15) return 'acceptable';
  if (shippingDays <= 25) return 'slow';
  return 'disqualified';
}

function slaScore(status: SlaStatus): number {
  switch (status) {
    case 'fast': return 10;
    case 'acceptable': return 7;
    case 'slow': return 3;
    case 'disqualified': return 0;
    default: return 5; // unknown → neutral
  }
}

export interface RankedSupplier extends SupplierCandidate {
  supplierScore: number;
  rank: number;
  slaStatus: SlaStatus;
}

/**
 * Ranks suppliers by composite score (price 50%, SLA 35%, rating 15%) and returns top 5.
 * Disqualified suppliers are excluded from results unless all are disqualified.
 */
export function rankSuppliers(suppliers: SupplierCandidate[]): RankedSupplier[] {
  if (suppliers.length === 0) return [];

  const withSla = suppliers.map((s) => ({
    ...s,
    slaStatus: classifySla(s.shippingDays)
  }));

  // Filter disqualified — fall back to including them only if all are disqualified
  const eligible = withSla.filter((s) => s.slaStatus !== 'disqualified');
  const pool = eligible.length > 0 ? eligible : withSla;

  const prices = pool.map((s) => s.priceUsd);
  const ratings = pool.map((s) => s.rating ?? 0);
  const moqs = pool.map((s) => s.moq);

  const priceNorm = normLowerIsBetter(prices);
  const ratingNorm = normHigherIsBetter(ratings);
  const moqNorm = normLowerIsBetter(moqs);

  const scored = pool.map((s) => {
    const pScore = priceNorm(s.priceUsd) * 0.50;
    const sScore = (slaScore(s.slaStatus) / 10) * 0.35;
    const rScore = ratingNorm(s.rating ?? 0) * 0.15;
    const aeBonus = s.platform === 'aliexpress' ? 0.05 : 0;

    return {
      ...s,
      supplierScore: Math.max(0, Math.min(1, pScore + sScore + rScore + aeBonus))
    };
  });

  scored.sort((a, b) => (b.supplierScore ?? 0) - (a.supplierScore ?? 0));

  return scored.slice(0, 5).map((s, idx) => ({ ...s, rank: idx + 1 }));
}
