import type { SupplierCandidate } from '../../shared/types';

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
 * Ranks suppliers by composite score and returns top 5.
 */
export function rankSuppliers(
  suppliers: SupplierCandidate[]
): Array<SupplierCandidate & { supplierScore: number; rank: number }> {
  if (suppliers.length === 0) return [];

  const prices = suppliers.map((s) => s.priceUsd);
  const ratings = suppliers.map((s) => (s.rating ?? 0));
  const shippings = suppliers.map((s) => s.shippingDays ?? 99);
  const moqs = suppliers.map((s) => s.moq);

  const priceNorm = normLowerIsBetter(prices);
  const ratingNorm = normHigherIsBetter(ratings);
  const shipNorm = normLowerIsBetter(shippings);
  const moqNorm = normLowerIsBetter(moqs);

  const scored = suppliers.map((s) => {
    const base =
      priceNorm(s.priceUsd) * 0.4 +
      ratingNorm(s.rating ?? 0) * 0.3 +
      shipNorm(s.shippingDays ?? 99) * 0.2 +
      moqNorm(s.moq) * 0.1;
    const aeBonus = s.platform === 'aliexpress' ? 0.12 : 0;

    return {
      ...s,
      supplierScore: Math.max(0, Math.min(1, base + aeBonus))
    };
  });

  scored.sort((a, b) => (b.supplierScore ?? 0) - (a.supplierScore ?? 0));

  const top = scored.slice(0, 5).map((s, idx) => ({ ...s, rank: idx + 1 }));
  return top;
}
