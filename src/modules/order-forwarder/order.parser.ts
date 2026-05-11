import type {
  IncomingOrder,
  IncomingOrderLineItem,
  ShippingAddress
} from '../../shared/types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function asPositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.floor(value)
      : typeof value === 'string'
        ? Math.floor(Number(value))
        : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = asTrimmedString(obj[k]);
    if (v) return v;
  }
  return null;
}

/**
 * Extracts a numeric phone-country code from a "+1-555-0100" / "+44 7700 900000"
 * style phone string. Returns null when no leading "+" prefix is present.
 */
function extractPhoneCountry(phone: string | null): string | null {
  if (!phone) return null;
  const m = phone.match(/^\+(\d{1,4})/);
  return m && m[1] ? m[1] : null;
}

function parseLineItem(raw: unknown): IncomingOrderLineItem | null {
  if (!isObject(raw)) return null;
  const productId = asTrimmedString(raw['product_id']);
  if (!productId) return null;

  const title = asTrimmedString(raw['title']) ?? '';
  return {
    shopifyProductId: productId,
    shopifyVariantId: asTrimmedString(raw['variant_id']),
    sku: asTrimmedString(raw['sku']),
    title,
    quantity: asPositiveInt(raw['quantity'], 1)
  };
}

function parseShippingAddress(raw: unknown): ShippingAddress | null {
  if (!isObject(raw)) return null;

  const first = asTrimmedString(raw['first_name']);
  const last = asTrimmedString(raw['last_name']);
  const fullName =
    asTrimmedString(raw['name']) ??
    [first, last].filter((s): s is string => Boolean(s)).join(' ').trim();
  if (!fullName) return null;

  const address1 = asTrimmedString(raw['address1']);
  if (!address1) return null;

  const country = pickString(raw, 'country_code', 'country');
  if (!country) return null;

  const phone = asTrimmedString(raw['phone']);

  return {
    fullName,
    address1,
    address2: asTrimmedString(raw['address2']),
    city: asTrimmedString(raw['city']) ?? '',
    province: pickString(raw, 'province_code', 'province') ?? '',
    zip: asTrimmedString(raw['zip']) ?? '',
    country,
    phone: phone ?? '',
    phoneCountry: extractPhoneCountry(phone),
    email: asTrimmedString(raw['email'])
  };
}

/**
 * Parses a Shopify orders/create webhook body into a normalized IncomingOrder.
 *
 * Returns null when the payload is not a valid order envelope (missing id,
 * non-object, etc.). Line items without a product_id are silently dropped
 * (they are usually custom one-off items the supplier flow can't fulfill).
 */
export function parseShopifyOrderWebhook(raw: unknown): IncomingOrder | null {
  if (!isObject(raw)) return null;

  const shopifyOrderId = asTrimmedString(raw['id']);
  if (!shopifyOrderId) return null;

  const lineItemsRaw = Array.isArray(raw['line_items']) ? raw['line_items'] : [];
  const lineItems = lineItemsRaw
    .map(parseLineItem)
    .filter((li): li is IncomingOrderLineItem => li !== null);

  return {
    shopifyOrderId,
    shopifyOrderName: asTrimmedString(raw['name']),
    email: asTrimmedString(raw['email']),
    currency: asTrimmedString(raw['currency']) ?? 'USD',
    totalPriceUsd: asPositiveNumber(raw['total_price']),
    shippingAddress: parseShippingAddress(raw['shipping_address']),
    lineItems
  };
}
