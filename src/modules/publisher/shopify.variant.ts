import axios from 'axios';
import logger from '../../shared/logger';

type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export function money2(n: number): string {
  const v = Math.round(n * 100) / 100;
  return v.toFixed(2);
}

function roundTo99(n: number): number {
  const dollars = Math.floor(n);
  return dollars + 0.99;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Tiered compare-at (same heuristic as scripts/shopify-set-prices.ts).
 */
export function computeCompareAtPrice(price: number): number {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return 0;

  const targetDivisor = p < 25 ? 0.75 : p <= 60 ? 0.7 : 0.65;
  const raw = p / targetDivisor;
  const min = p * 1.15;
  const max = p / 0.55;
  const clamped = clamp(raw, min, max);
  const rounded = roundTo99(clamped);
  if (rounded <= p) return roundTo99(p * 1.15);
  return rounded;
}

type VariantLookupData = {
  product?: {
    variants?: { nodes?: Array<{ id: string }> };
  } | null;
};

function numericProductIdFromShopifyProductGid(gid: string): string | null {
  const m = gid.trim().match(/\/Product\/(\d+)\s*$/);
  return m?.[1] ?? null;
}

function adminRestProductsPrefix(graphqlUrl: string): string {
  const u = new URL(graphqlUrl);
  const parts = u.pathname.replace(/^\//, '').split('/');
  // /admin/api/2025-01/graphql.json → .../products/{id}.json
  if (parts.length >= 3 && parts[0] === 'admin' && parts[1] === 'api')
    return `${u.origin}/${parts[0]}/${parts[1]}/${parts[2]}`;
  return `${u.origin}/admin/api/2025-01`;
}

async function restFirstVariantGid(params: {
  adminRestProductsPrefix: string;
  accessToken: string;
  productNumericId: string;
}): Promise<string | null> {
  const res = await axios.get<{ product?: { variants?: Array<{ admin_graphql_api_id?: string; id?: number }> } }>(
    `${params.adminRestProductsPrefix}/products/${params.productNumericId}.json`,
    {
      headers: { 'X-Shopify-Access-Token': params.accessToken, 'Content-Type': 'application/json' },
      validateStatus: () => true,
      timeout: 30_000
    }
  );
  if (res.status < 200 || res.status >= 300 || !res.data?.product?.variants?.length) {
    return null;
  }
  const v = res.data.product.variants[0];
  if (v?.admin_graphql_api_id) return v.admin_graphql_api_id;
  if (typeof v?.id === 'number') return `gid://shopify/ProductVariant/${v.id}`;
  return null;
}

type VariantsBulkUpdateData = {
  productVariantsBulkUpdate?: {
    userErrors?: Array<{ field?: string[]; message: string }> | null;
  } | null;
};

/**
 * Prices the default (first) variant and allows selling without inventory tracking,
 * required for storefront checkout on many dropshipping setups.
 */
export async function applyDefaultVariantPricing(params: {
  graphqlUrl: string;
  headers: Record<string, string>;
  shopifyProductGid: string;
  retailUsd: number;
  setCompareAt: boolean;
}): Promise<void> {
  const { graphqlUrl, headers, shopifyProductGid, retailUsd, setCompareAt } = params;

  const lookupQuery = `
    query variantForProduct($id: ID!) {
      product(id: $id) {
        variants(first: 25) {
          nodes { id }
        }
      }
    }
  `;

  const lookup = (
    await axios.post<ShopifyGraphqlResponse<VariantLookupData>>(
      graphqlUrl,
      { query: lookupQuery, variables: { id: shopifyProductGid } },
      { headers }
    )
  ).data;

  if (lookup.errors?.length) {
    logger.warn('shopify variant lookup errors', {
      errors: lookup.errors,
      shopifyProductGid
    });
    return;
  }

  let variantId = lookup.data?.product?.variants?.nodes?.[0]?.id ?? null;
  if (!variantId) {
    const token = headers['X-Shopify-Access-Token'] ?? '';
    const nid = numericProductIdFromShopifyProductGid(shopifyProductGid);
    if (token && nid) {
      variantId =
        (await restFirstVariantGid({
          adminRestProductsPrefix: adminRestProductsPrefix(graphqlUrl),
          accessToken: token,
          productNumericId: nid
        })) ?? null;
    }
  }
  if (!variantId) {
    logger.warn('shopify: no variant on new product — price not applied', {
      shopifyProductGid
    });
    return;
  }

  const newPrice = money2(Number(retailUsd));
  const compareAt = setCompareAt ? money2(computeCompareAtPrice(Number(retailUsd))) : null;

  const updateMutation = `
    mutation variantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }
  `;

  const upd = (
    await axios.post<ShopifyGraphqlResponse<VariantsBulkUpdateData>>(
      graphqlUrl,
      {
        query: updateMutation,
        variables: {
          productId: shopifyProductGid,
          variants: [
            {
              id: variantId,
              price: newPrice,
              compareAtPrice: compareAt ?? undefined,
              inventoryPolicy: 'CONTINUE'
            }
          ]
        }
      },
      { headers }
    )
  ).data;

  const errs = upd.data?.productVariantsBulkUpdate?.userErrors ?? null;
  if (upd.errors?.length || (errs && errs.length > 0)) {
    logger.warn('shopify variant price update failed', {
      shopifyProductGid,
      variantId,
      errors: upd.errors,
      userErrors: errs
    });
    return;
  }

  logger.info('shopify default variant priced', {
    shopifyProductGid,
    variantId,
    price: newPrice,
    compareAt
  });
}
