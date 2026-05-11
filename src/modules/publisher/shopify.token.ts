import crypto from 'node:crypto';
import axios from 'axios';
import { query } from '../../config/db';
import { env } from '../../config/env';

const CONFIG_TOKEN_KEY = 'shopify_admin_access_token';
const CONFIG_SHOP_KEY = 'shopify_shop';

export async function getShopifyAccessToken(): Promise<string> {
  const rows = await query<{ value: string }>(
    'SELECT value FROM pipeline_config WHERE key = $1 LIMIT 1',
    [CONFIG_TOKEN_KEY]
  );
  const token = rows[0]?.value?.trim() ?? '';
  if (token.length > 0) return token;

  // Back-compat for older custom-app based setups
  const legacy = env.SHOPIFY_ADMIN_TOKEN?.trim() ?? '';
  return legacy;
}

export async function setShopifyAccessToken(params: {
  shop: string;
  accessToken: string;
}): Promise<void> {
  await query(
    `INSERT INTO pipeline_config (key, value, updated_at)
     VALUES ($1,$2,now())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [CONFIG_TOKEN_KEY, params.accessToken]
  );
  await query(
    `INSERT INTO pipeline_config (key, value, updated_at)
     VALUES ($1,$2,now())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [CONFIG_SHOP_KEY, params.shop]
  );
}

/**
 * Shopify OAuth callback querystring HMAC verification.
 * See: https://shopify.dev/docs/apps/auth/get-access-token/verify-installation
 */
export function verifyShopifyQueryHmac(params: {
  apiSecret: string;
  query: Record<string, string | string[] | undefined>;
}): boolean {
  const { apiSecret, query } = params;
  const provided = typeof query.hmac === 'string' ? query.hmac : '';
  if (!provided) return false;

  const entries: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(query)) {
    if (k === 'hmac' || k === 'signature') continue;
    if (typeof v === 'string') entries.push([k, v]);
    else if (Array.isArray(v)) entries.push([k, v.join(',')]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = entries.map(([k, v]) => `${k}=${v}`).join('&');

  const expected = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

export async function exchangeShopifyOAuthCode(params: {
  shop: string;
  code: string;
}): Promise<string> {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET) {
    throw new Error('Missing SHOPIFY_API_KEY/SHOPIFY_API_SECRET for OAuth exchange');
  }

  const url = `https://${params.shop}/admin/oauth/access_token`;
  const res = await axios.post(
    url,
    {
      client_id: env.SHOPIFY_API_KEY,
      client_secret: env.SHOPIFY_API_SECRET,
      code: params.code
    },
    { timeout: 20_000 }
  );

  const data = res.data as unknown as { access_token?: unknown };
  const token = typeof data?.access_token === 'string' ? data.access_token : '';
  if (!token) throw new Error('OAuth exchange did not return access_token');
  return token;
}

