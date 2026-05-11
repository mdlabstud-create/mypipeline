import axios from 'axios';
import crypto from 'node:crypto';
import { env } from '../../config/env';
import logger from '../../shared/logger';

const API_BASE = 'https://api-sg.aliexpress.com';

/**
 * AliExpress Open Platform OAuth (api-sg.aliexpress.com).
 *
 * Authorize URL: GET /oauth/authorize?response_type=code&force_auth=true&client_id=...&redirect_url=...&state=...
 * NOTE: parameter is `redirect_url`, NOT `redirect_uri`.
 *
 * Token exchange: regular API call to POST /sync with method=/auth/token/create
 * System params + biz params signed with HMAC-SHA256 using app_secret as the key.
 */

export function buildAliExpressAuthorizeUrl(params: { redirectUri: string; state: string }): string {
  const { redirectUri, state } = params;
  const url = new URL(`${API_BASE}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('force_auth', 'true');
  url.searchParams.set('redirect_url', redirectUri);
  url.searchParams.set('client_id', env.ALIEXPRESS_APP_KEY);
  url.searchParams.set('state', state);
  return url.toString();
}

export function randomState(): string {
  return crypto.randomBytes(16).toString('hex');
}

function hmacSha256HexUpper(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex').toUpperCase();
}

/**
 * Sort params alphabetically by key, concatenate as key1value1key2value2... (no separator),
 * then HMAC-SHA256 with app_secret. Hex uppercase.
 */
export function signAliExpressParams(params: Record<string, string>, secret: string): string {
  const keys = Object.keys(params).sort();
  const concat = keys.map((k) => `${k}${params[k]}`).join('');
  return hmacSha256HexUpper(secret, concat);
}

export type AliExpressTokenResult = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  refreshExpiresIn: number | null;
  sellerId: string | null;
  userNick: string | null;
  raw: unknown;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Posts a signed `/sync` call against the AliExpress auth endpoints and parses
 * the standard `{access_token, refresh_token, expires_in, ...}` response.
 *
 * Used by both `exchangeAliExpressOAuthCode` (`/auth/token/create`) and
 * `refreshAliExpressOAuthToken` (`/auth/token/refresh`). Both endpoints share
 * the same response shape and signing scheme.
 */
async function callAliExpressAuthMethod(
  method: '/auth/token/create' | '/auth/token/refresh',
  biz: Record<string, string>,
  context: 'exchange' | 'refresh'
): Promise<AliExpressTokenResult> {
  const sysParams: Record<string, string> = {
    app_key: env.ALIEXPRESS_APP_KEY,
    format: 'json',
    method,
    sign_method: 'sha256',
    simplify: 'true',
    timestamp: String(Date.now()),
    ...biz
  };
  const sign = signAliExpressParams(sysParams, env.ALIEXPRESS_APP_SECRET);
  const body = new URLSearchParams({ ...sysParams, sign });

  const res = await axios.post(`${API_BASE}/sync`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    timeout: 30_000,
    validateStatus: () => true
  });

  const data: unknown = res.data;
  logger.info('aliexpress oauth response', {
    context,
    method,
    status: res.status,
    hasAccessToken: isObject(data) && typeof data['access_token'] === 'string',
    keys: isObject(data) ? Object.keys(data) : typeof data
  });

  if (
    isObject(data) &&
    !asString(data['access_token']) &&
    (isObject(data['error_response']) || asString(data['code']) || asString(data['message']))
  ) {
    const errResp: Record<string, unknown> = isObject(data['error_response'])
      ? data['error_response']
      : data;
    logger.error('aliexpress oauth failed', { context, method, error: errResp });
    const msg = asString(errResp['msg']) ?? asString(errResp['message']) ?? 'unknown error';
    const subMsg = asString(errResp['sub_msg']) ?? '';
    throw new Error(`AliExpress OAuth ${context} failed: ${msg}${subMsg ? ` — ${subMsg}` : ''}`);
  }

  const access = asString(isObject(data) ? data['access_token'] : null);
  if (!access) {
    logger.error('aliexpress oauth missing access_token', { context, method, data });
    throw new Error(`AliExpress OAuth ${context} failed (missing access_token)`);
  }

  return {
    accessToken: access,
    refreshToken: asString(isObject(data) ? data['refresh_token'] : null),
    expiresIn: asNumber(isObject(data) ? data['expires_in'] : null),
    refreshExpiresIn: asNumber(isObject(data) ? data['refresh_expires_in'] : null),
    sellerId: asString(isObject(data) ? data['seller_id'] : null),
    userNick: asString(isObject(data) ? data['user_nick'] : null),
    raw: data
  };
}

export async function exchangeAliExpressOAuthCode(params: {
  code: string;
  redirectUri: string;
}): Promise<AliExpressTokenResult> {
  return callAliExpressAuthMethod('/auth/token/create', { code: params.code }, 'exchange');
}

/**
 * Trades an unexpired refresh_token for a fresh access_token (and a fresh
 * refresh_token). Call this when an existing access_token is near expiry.
 */
export async function refreshAliExpressOAuthToken(params: {
  refreshToken: string;
}): Promise<AliExpressTokenResult> {
  return callAliExpressAuthMethod(
    '/auth/token/refresh',
    { refresh_token: params.refreshToken },
    'refresh'
  );
}
