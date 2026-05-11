import { ValidationError } from '../../shared/errors';
import { query } from '../../config/db';
import { roundDownToCharm99 } from '../../shared/charm-price';

/**
 * Rounds a price down to the nearest $0.99 charm price (same as listing retail rounding).
 */
export function roundTo99(price: number): number {
  return roundDownToCharm99(price);
}

export interface DynamicPriceInput {
  costUsd: number;
  competitorPrice?: number;
  targetMarginPct: number;
  minMarkup: number;
  maxCompetitorRatio: number;
  holidayMode: boolean;
  holidayMarkupMultiplier: number;
  minMarginPct: number;
}

export interface DynamicPriceOutput {
  retailUsd: number;
  marginPct: number;
}

/**
 * Computes a dynamic retail price with competitor ceiling and margin floor.
 */
export function computeDynamicPrice(input: DynamicPriceInput): DynamicPriceOutput {
  const minPrice = input.costUsd * input.minMarkup;
  const maxPrice =
    input.competitorPrice !== undefined
      ? input.competitorPrice * input.maxCompetitorRatio
      : input.costUsd * 4.0;

  const targetPrice = input.costUsd / (1 - input.targetMarginPct / 100);
  const clamped = Math.max(minPrice, Math.min(maxPrice, targetPrice));
  const holidayAdjusted = input.holidayMode
    ? clamped * input.holidayMarkupMultiplier
    : clamped;

  const retailUsd = roundTo99(holidayAdjusted);
  const marginPct = ((retailUsd - input.costUsd) / retailUsd) * 100;

  if (marginPct < input.minMarginPct) {
    throw new ValidationError('Margin too low', 'margin', marginPct);
  }

  return { retailUsd, marginPct: Math.round(marginPct * 100) / 100 };
}

/**
 * Loads a listing by id and applies dynamic pricing rules, persisting results.
 */
export async function applyDynamicPricing(listingId: string, input: Omit<DynamicPriceInput, 'costUsd'> & { competitorPrice?: number }): Promise<void> {
  const rows = await query<{ cost_usd: number }>(
    'SELECT cost_usd FROM product_listings WHERE id = $1 LIMIT 1',
    [listingId]
  );
  const cost = rows[0]?.cost_usd;
  if (cost === undefined) return;

  const computed = computeDynamicPrice({ ...input, costUsd: cost });
  await query(
    'UPDATE product_listings SET retail_usd=$2, margin_pct=$3, updated_at=now() WHERE id=$1',
    [listingId, computed.retailUsd, computed.marginPct]
  );
}
