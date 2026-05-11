import { describe, expect, it, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// Mock the env module so app_key/app_secret are deterministic for sign verification.
vi.mock('../../src/config/env', () => ({
  env: {
    ALIEXPRESS_APP_KEY: 'TESTKEY',
    ALIEXPRESS_APP_SECRET: 'TESTSECRET',
    ALIEXPRESS_TRACKING_ID: 'TESTTRACK',
    NODE_ENV: 'test'
  }
}));

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn()
  }
}));

vi.mock('../../src/shared/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logPipelineEvent: vi.fn()
}));

describe('signAliExpressParams', () => {
  it('produces an upper-case hex HMAC-SHA256 of sorted "key1value1key2value2…"', async () => {
    const { signAliExpressParams } = await import(
      '../../src/modules/researcher/aliexpress.oauth'
    );

    const params = { method: '/auth/token/create', code: 'C', timestamp: '123' };
    const expected = crypto
      .createHmac('sha256', 'sec')
      .update('codeCmethod/auth/token/createtimestamp123', 'utf8')
      .digest('hex')
      .toUpperCase();

    expect(signAliExpressParams(params, 'sec')).toBe(expected);
  });
});

describe('refreshAliExpressOAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POSTs /sync with method=/auth/token/refresh and the refresh_token', async () => {
    const axios = (await import('axios')).default;
    (axios.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: {
        access_token: 'NEW_ACCESS',
        refresh_token: 'NEW_REFRESH',
        expires_in: 86400,
        refresh_expires_in: 2_592_000,
        seller_id: 'S1',
        user_nick: 'demo'
      }
    });

    const { refreshAliExpressOAuthToken } = await import(
      '../../src/modules/researcher/aliexpress.oauth'
    );
    const result = await refreshAliExpressOAuthToken({ refreshToken: 'OLD_REFRESH' });

    expect(result.accessToken).toBe('NEW_ACCESS');
    expect(result.refreshToken).toBe('NEW_REFRESH');
    expect(result.expiresIn).toBe(86400);
    expect(result.refreshExpiresIn).toBe(2_592_000);
    expect(result.sellerId).toBe('S1');
    expect(result.userNick).toBe('demo');

    const post = axios.post as unknown as ReturnType<typeof vi.fn>;
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0]!;
    expect(url).toBe('https://api-sg.aliexpress.com/sync');
    expect(body).toBeInstanceOf(URLSearchParams);
    const sentParams = body as URLSearchParams;
    expect(sentParams.get('method')).toBe('/auth/token/refresh');
    expect(sentParams.get('refresh_token')).toBe('OLD_REFRESH');
    expect(sentParams.get('app_key')).toBe('TESTKEY');
    expect(sentParams.get('sign_method')).toBe('sha256');
    expect(sentParams.get('sign')).toMatch(/^[0-9A-F]+$/);
  });

  it('throws a descriptive error when AE returns error_response', async () => {
    const axios = (await import('axios')).default;
    (axios.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: {
        error_response: {
          code: '15',
          msg: 'invalid refresh token',
          sub_msg: 'expired'
        }
      }
    });

    const { refreshAliExpressOAuthToken } = await import(
      '../../src/modules/researcher/aliexpress.oauth'
    );

    await expect(
      refreshAliExpressOAuthToken({ refreshToken: 'BAD' })
    ).rejects.toThrow(/invalid refresh token.*expired/);
  });

  it('throws when the response has no access_token', async () => {
    const axios = (await import('axios')).default;
    (axios.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      data: { something_else: 'oops' }
    });

    const { refreshAliExpressOAuthToken } = await import(
      '../../src/modules/researcher/aliexpress.oauth'
    );

    await expect(refreshAliExpressOAuthToken({ refreshToken: 'X' })).rejects.toThrow(
      /missing access_token/
    );
  });
});
