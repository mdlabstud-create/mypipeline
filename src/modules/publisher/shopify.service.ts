import axios from 'axios';
import { env } from '../../config/env';
import { query } from '../../config/db';
import logger, { logPipelineEvent } from '../../shared/logger';
import { PublisherError } from '../../shared/errors';
import { checkDuplicate, findPublishedDuplicateBySupplierTitle } from './duplicate.check';
import { getFullListingById } from './publisher.types';
import type { ProductListing } from '../../shared/types';
import { getShopifyAccessToken } from './shopify.token';
import { applyDefaultVariantPricing } from './shopify.variant';

type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type ShopifyProductCreateData = {
  productCreate?: {
    product?: { id?: string; handle?: string } | null;
    userErrors?: Array<{ field?: string[]; message: string }> | null;
  } | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Safe diagnostic payload for logs/errors (never includes auth headers / tokens).
 */
function summarizeAxiosLikeError(error: unknown): Record<string, unknown> {
  if (!isObject(error)) return { detail: String(error) };
  const e = error as {
    message?: unknown;
    code?: unknown;
    response?: { status?: unknown; data?: unknown };
  };
  return {
    message: typeof e.message === 'string' ? e.message : undefined,
    code: typeof e.code === 'string' ? e.code : undefined,
    status: e.response?.status,
    data: e.response?.data
  };
}

function parseProductCreateData(data: unknown): ShopifyProductCreateData | null {
  if (!isObject(data)) return null;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return data as ShopifyProductCreateData;
}

/**
 * Replaces an existing Shopify product's content + price with a better-margin version.
 * Marks the old listing 'superseded' and the new listing 'published' using the same shopify_id.
 */
async function updateExistingShopifyListing(params: {
  graphqlUrl: string;
  headers: Record<string, string>;
  existingListingId: string;
  shopifyId: string;
  shopifyHandle: string;
  newListing: ProductListing;
  newListingId: string;
  existingMarginPct: number;
}): Promise<void> {
  const { graphqlUrl, headers, existingListingId, shopifyId, shopifyHandle, newListing, newListingId, existingMarginPct } = params;

  const descriptionHtml = newListing.description
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${p}</p>`)
    .join('');

  const updateMutation = `
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id handle }
        userErrors { field message }
      }
    }
  `;

  let updateRes: ShopifyGraphqlResponse<unknown>;
  try {
    const res = await axios.post(
      graphqlUrl,
      {
        query: updateMutation,
        variables: {
          input: {
            id: shopifyId,
            title: newListing.title,
            descriptionHtml,
            tags: newListing.tags,
            seo: {
              title: newListing.seoTitle ?? undefined,
              description: newListing.seoDescription ?? undefined
            }
          }
        }
      },
      { headers }
    );
    updateRes = res.data as ShopifyGraphqlResponse<unknown>;
  } catch (error: unknown) {
    throw new PublisherError('Shopify productUpdate request failed', newListingId, summarizeAxiosLikeError(error));
  }

  if (updateRes.errors?.length) {
    throw new PublisherError('Shopify productUpdate returned errors', newListingId, updateRes.errors);
  }

  await applyDefaultVariantPricing({
    graphqlUrl,
    headers,
    shopifyProductGid: shopifyId,
    retailUsd: newListing.retailUsd,
    setCompareAt: true
  });

  // Release the unique index slot on the old listing before claiming it for the new one.
  await query(`UPDATE product_listings SET status = 'superseded', updated_at = now() WHERE id = $1`, [existingListingId]);
  await query(
    `UPDATE product_listings SET shopify_id = $2, shopify_handle = $3, status = 'published', published_at = now() WHERE id = $1`,
    [newListingId, shopifyId, shopifyHandle]
  );

  await logPipelineEvent({
    stage: 'publisher',
    status: 'ok',
    message: 'updated shopify listing with better-margin version',
    payload: {
      newListingId,
      existingListingId,
      shopifyId,
      oldMarginPct: existingMarginPct,
      newMarginPct: newListing.marginPct
    }
  });
}

/**
 * Publishes an approved listing to Shopify (ACTIVE by default, optional DRAFT).
 *
 * Enforces approval gate (#1).
 */
export async function publishToShopify(
  listingId: string,
  opts?: { shopifyStatus?: 'ACTIVE' | 'DRAFT' }
): Promise<void> {
  if (
    env.DEMO_MODE ||
    env.SHOPIFY_STORE_URL.trim().toLowerCase().startsWith('example.')
  ) {
    throw new PublisherError('Shopify publishing disabled (demo/local credentials)', listingId);
  }

  const accessToken = (await getShopifyAccessToken()).trim();
  if (!accessToken || accessToken.toLowerCase() === 'dummy') {
    throw new PublisherError('Shopify access token missing/invalid', listingId);
  }

  const listing = await getFullListingById(listingId);
  if (!listing) {
    throw new PublisherError('Listing not found', listingId);
  }

  if (listing.status !== 'approved') {
    throw new PublisherError('Product not approved', listingId);
  }

  const url = `https://${env.SHOPIFY_STORE_URL}/admin/api/2025-01/graphql.json`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken
  };

  // Check if the same AliExpress product is already published. If so, only proceed
  // when this listing has a strictly better margin — in that case update in place.
  const sameProduct = await findPublishedDuplicateBySupplierTitle(listingId, listing.supplierId);
  if (sameProduct) {
    if (listing.marginPct > sameProduct.marginPct) {
      await updateExistingShopifyListing({
        graphqlUrl: url,
        headers,
        existingListingId: sameProduct.listingId,
        shopifyId: sameProduct.shopifyId,
        shopifyHandle: sameProduct.shopifyHandle,
        newListing: listing,
        newListingId: listingId,
        existingMarginPct: sameProduct.marginPct
      });
    } else {
      await query('UPDATE product_listings SET status = $2 WHERE id = $1', [listingId, 'duplicate']);
      await logPipelineEvent({
        stage: 'publisher',
        status: 'ok',
        message: 'skipped: same product already published with equal or better margin',
        payload: { listingId, existingListingId: sameProduct.listingId, existingMarginPct: sameProduct.marginPct, newMarginPct: listing.marginPct }
      });
    }
    return;
  }

  const isDup = await checkDuplicate(
    listingId,
    listing.title,
    listing.tags,
    listing.productId
  );
  if (isDup) {
    await query('UPDATE product_listings SET status = $2 WHERE id = $1', [
      listingId,
      'duplicate'
    ]);
    return;
  }

  const mutation = `
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product { id handle }
        userErrors { field message }
      }
    }
  `;

  const descriptionHtml = listing.description
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${p}</p>`)
    .join('');

  const shopifyProductStatus = opts?.shopifyStatus ?? 'ACTIVE';

  const variables = {
    input: {
      title: listing.title,
      descriptionHtml,
      tags: listing.tags,
      status: shopifyProductStatus,
      seo: {
        title: listing.seoTitle ?? undefined,
        description: listing.seoDescription ?? undefined
      }
    }
  };

  const doRequest = async (): Promise<ShopifyGraphqlResponse<unknown>> => {
    const res = await axios.post(url, { query: mutation, variables }, { headers });
    return res.data as ShopifyGraphqlResponse<unknown>;
  };

  let response: ShopifyGraphqlResponse<unknown>;
  try {
    response = await doRequest();
  } catch (error: unknown) {
    const status =
      isObject(error) && isObject((error as { response?: unknown }).response)
        ? ((error as { response: { status?: unknown } }).response.status as
            | number
            | undefined)
        : undefined;
    const retryAfter =
      isObject(error) && isObject((error as { response?: unknown }).response)
        ? ((error as { response: { headers?: unknown } }).response.headers as
            | Record<string, unknown>
            | undefined)
        : undefined;
    const retryAfterHeader =
      retryAfter && typeof retryAfter['retry-after'] === 'string'
        ? retryAfter['retry-after']
        : undefined;

    if (status === 429 && retryAfterHeader) {
      const seconds = Number(retryAfterHeader);
      const waitMs = Number.isFinite(seconds) ? (seconds + 1) * 1000 : 31_000;
      await new Promise((r) => setTimeout(r, waitMs));
      response = await doRequest();
    } else {
      const summary = summarizeAxiosLikeError(error);
      logger.error('shopify request failed', { listingId, ...summary });
      throw new PublisherError('Shopify request failed', listingId, summary);
    }
  }

  if (response.errors && response.errors.length > 0) {
    throw new PublisherError('Shopify returned errors', listingId, response.errors);
  }

  const parsed = parseProductCreateData(response.data);
  const productId = parsed?.productCreate?.product?.id;
  const handle = parsed?.productCreate?.product?.handle;

  if (!productId || !handle) {
    throw new PublisherError('Shopify productCreate failed', listingId, response.data);
  }

  // Attach media in a second step (ProductInput does not accept images/media in newer API versions).
  if (listing.images.length > 0) {
    const mediaMutation = `
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          mediaUserErrors { field message }
        }
      }
    `;

    const mediaVars = {
      productId,
      media: listing.images.map((originalSource) => ({
        mediaContentType: 'IMAGE',
        originalSource
      }))
    };

    let mediaData: ShopifyGraphqlResponse<unknown>;
    try {
      const mediaRes = await axios.post(
        url,
        { query: mediaMutation, variables: mediaVars },
        { headers }
      );
      mediaData = mediaRes.data as ShopifyGraphqlResponse<unknown>;
    } catch (error: unknown) {
      const summary = summarizeAxiosLikeError(error);
      logger.error('shopify media request failed', { listingId, ...summary });
      throw new PublisherError('Shopify media request failed', listingId, summary);
    }
    if (mediaData.errors && mediaData.errors.length > 0) {
      throw new PublisherError('Shopify returned errors (media)', listingId, mediaData.errors);
    }

    const mediaRoot = mediaData.data;
    let mediaUserErrors: unknown = null;
    if (isObject(mediaRoot)) {
      const pcm = mediaRoot['productCreateMedia'];
      if (isObject(pcm)) {
        mediaUserErrors = pcm['mediaUserErrors'];
      }
    }
    if (
      Array.isArray(mediaUserErrors) &&
      mediaUserErrors.length > 0
    ) {
      throw new PublisherError('Shopify productCreateMedia failed', listingId, mediaUserErrors);
    }
  }

  await applyDefaultVariantPricing({
    graphqlUrl: url,
    headers,
    shopifyProductGid: productId,
    retailUsd: listing.retailUsd,
    setCompareAt: true
  });

  await query(
    'UPDATE product_listings SET shopify_id = $2, shopify_handle = $3, status = $4, published_at = now() WHERE id = $1',
    [listingId, productId, handle, 'published']
  );

  await logPipelineEvent({
    stage: 'publisher',
    status: 'ok',
    message: `published listing to shopify (${shopifyProductStatus.toLowerCase()})`,
    payload: { listingId, shopifyId: productId, shopifyProductStatus }
  });
}