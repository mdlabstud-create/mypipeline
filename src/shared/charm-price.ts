/**
 * Largest dollar amount ending in `.99` that does not exceed `price`.
 *
 * Older logic always used `(floor(price) - 1) + 0.99`, which pulled values like `$33.70`
 * down to `$31.99` (two-dollar bucket collapse) so many unrelated SKUs clamped to the
 * same storefront price after `anchor * ratio`.
 */
export function roundDownToCharm99(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const p = Math.round(price * 1e4) / 1e4;
  if (p <= 0.99) return 0.99;
  const d = Math.floor(p);
  const atDollar = d + 0.99;
  if (atDollar <= p + 1e-9) return Math.round(atDollar * 100) / 100;
  const below = d - 1 + 0.99;
  if (below > 0) return Math.round(below * 100) / 100;
  return 0.99;
}
