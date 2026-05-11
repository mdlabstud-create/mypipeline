import { ValidationError } from '../../shared/errors';
import { roundDownToCharm99 } from '../../shared/charm-price';

export interface PricingResult {
  costUsd: number;
  retailUsd: number;
  marginPct: number;
}

export interface PricingOptions {
  markupMultiplier: number;
  minMarginPct: number;
  /** Amazon listing price captured at scrape time. */
  amazonRetailAnchorUsd?: number | null;
  /** TikTok retail price captured at scrape time. */
  tiktokRetailAnchorUsd?: number | null;
  /**
   * Store price is set to `referencePrice × ratio` when an anchor exists.
   * Must be < 1 so the store always undercuts the reference market.
   * Default: 0.9 (10% below the cheapest reference price).
   */
  storeVsAmazonRatio?: number;
}

/**
 * Calculates retail price against supplier cost.
 *
 * When a market reference price (Amazon or TikTok) is available:
 *   retail = min(anchors) × ratio   — must be strictly below the reference
 *   If that retail does not clear minMarginPct over cost, the product is
 *   rejected (ValidationError) rather than raised above the reference.
 *
 * When no reference exists:
 *   retail = cost × markupMultiplier, with a margin-floor raise if needed.
 */
export function calculatePricing(costUsd: number, opts: PricingOptions): PricingResult {
  const ratio = opts.storeVsAmazonRatio ?? 0.9;
  const minMargin = opts.minMarginPct;

  if (minMargin >= 100 || !Number.isFinite(minMargin)) {
    throw new ValidationError('Invalid min margin', 'minMarginPct', minMargin);
  }

  // Use the lowest available reference price so we undercut every market channel.
  const anchors = [opts.amazonRetailAnchorUsd, opts.tiktokRetailAnchorUsd]
    .filter((a): a is number => a != null && Number.isFinite(a) && a > 0);
  const referencePrice = anchors.length > 0 ? Math.min(...anchors) : null;

  let retailUsd: number;

  if (referencePrice != null) {
    retailUsd = roundDownToCharm99(referencePrice * ratio);

    // Store price must be strictly below every reference channel.
    if (retailUsd >= referencePrice) {
      throw new ValidationError(
        `Store price $${retailUsd} >= reference $${referencePrice} — rejected`,
        'retailUsd',
        retailUsd
      );
    }

    const marginAtAnchor = ((retailUsd - costUsd) / retailUsd) * 100;
    if (marginAtAnchor < minMargin) {
      throw new ValidationError(
        `Margin ${marginAtAnchor.toFixed(1)}% < ${minMargin}% at anchor price — AE cost too high to undercut market`,
        'margin',
        marginAtAnchor
      );
    }
  } else {
    // No market reference — price on markup alone.
    retailUsd = roundDownToCharm99(costUsd * opts.markupMultiplier);
    const marginPct = ((retailUsd - costUsd) / retailUsd) * 100;

    if (marginPct < minMargin) {
      const minRetailForMargin = roundDownToCharm99(costUsd / (1 - minMargin / 100));
      retailUsd = roundDownToCharm99(Math.max(retailUsd, minRetailForMargin));
    }
  }

  const finalMargin = ((retailUsd - costUsd) / retailUsd) * 100;

  if (finalMargin < minMargin) {
    throw new ValidationError('Margin too low', 'margin', finalMargin);
  }

  return { costUsd, retailUsd, marginPct: Math.round(finalMargin * 100) / 100 };
}
