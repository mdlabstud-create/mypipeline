import 'dotenv/config';
import axios, { isAxiosError } from 'axios';
import { env } from '../config/env';
import { getShopifyAccessToken } from '../modules/publisher/shopify.token';

const ids = ['9969339072759', '9969339302135', '9969339465975'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mediaEdgeCount(product: Record<string, unknown>): number {
  const media = product['media'];
  if (!isRecord(media)) return 0;
  const edges = media['edges'];
  return Array.isArray(edges) ? edges.length : 0;
}

function firstVariantPricing(product: Record<string, unknown>): {
  price?: string;
  compareAtPrice?: string | null;
} {
  const variants = product['variants'];
  if (!isRecord(variants)) return {};
  const edgesUnknown: unknown = variants['edges'];
  if (!Array.isArray(edgesUnknown) || edgesUnknown.length === 0) return {};
  const e0: unknown = edgesUnknown[0];
  if (!isRecord(e0)) return {};
  const node = e0['node'];
  if (!isRecord(node)) return {};
  const price = typeof node['price'] === 'string' ? node['price'] : undefined;
  const cap = node['compareAtPrice'];
  const out: {
    price?: string;
    compareAtPrice?: string | null;
  } = {};
  if (price !== undefined) out.price = price;
  if (cap === null) out.compareAtPrice = null;
  else if (typeof cap === 'string') out.compareAtPrice = cap;
  return out;
}

async function main(): Promise<void> {
  const token = (await getShopifyAccessToken()).trim();
  if (!token) {
    console.error('Missing Shopify access token');
    process.exit(1);
  }
  const store = env.SHOPIFY_STORE_URL;
  for (const id of ids) {
    const res = await axios.post(
      `https://${store}/admin/api/2024-10/graphql.json`,
      {
        query: `query($id:ID!){product(id:$id){id title status handle onlineStoreUrl onlineStorePreviewUrl media(first:50){edges{node{__typename}}} variants(first:1){edges{node{price compareAtPrice}}}}}`,
        variables: { id: `gid://shopify/Product/${id}` }
      },
      { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } }
    );

    const raw: unknown = res.data;
    if (!isRecord(raw)) {
      process.stdout.write(`${JSON.stringify({ id, error: 'non-object response' }, null, 2)}\n`);
      continue;
    }
    const data = raw['data'];
    if (!isRecord(data)) {
      process.stdout.write(`${JSON.stringify({ id, error: raw }, null, 2)}\n`);
      continue;
    }
    const product = data['product'];
    if (!isRecord(product)) {
      process.stdout.write(`${JSON.stringify({ id, error: raw }, null, 2)}\n`);
      continue;
    }

    const pv = firstVariantPricing(product);
    process.stdout.write(
      `${JSON.stringify(
        {
          id: typeof product['id'] === 'string' ? product['id'] : undefined,
          title: typeof product['title'] === 'string' ? product['title'] : undefined,
          status: typeof product['status'] === 'string' ? product['status'] : undefined,
          handle: typeof product['handle'] === 'string' ? product['handle'] : undefined,
          variantPrice: pv.price,
          variantCompareAt: pv.compareAtPrice,
          mediaCount: mediaEdgeCount(product),
          adminUrl: `https://${store}/admin/products/${id}`,
          onlineStoreUrl:
            typeof product['onlineStoreUrl'] === 'string' || product['onlineStoreUrl'] === null
              ? product['onlineStoreUrl']
              : undefined,
          previewUrl:
            typeof product['onlineStorePreviewUrl'] === 'string' ||
            product['onlineStorePreviewUrl'] === null
              ? product['onlineStorePreviewUrl']
              : undefined
        },
        null,
        2
      )}\n`
    );
  }
}

void main().catch((e: unknown) => {
  if (isAxiosError(e)) {
    console.error(e.response?.data ?? e.message);
  } else {
    console.error(String(e));
  }
  process.exit(1);
});
