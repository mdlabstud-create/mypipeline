import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/env', () => ({
  env: {
    ALIEXPRESS_APP_KEY: 'TESTKEY',
    ALIEXPRESS_APP_SECRET: 'TESTSECRET',
    ALIEXPRESS_TRACKING_ID: 'TESTTRACK',
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:3000',
    ALIEXPRESS_ACCESS_REFRESH_LEAD_MS: 24 * 60 * 60 * 1000
  }
}));

vi.mock('../../src/shared/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logPipelineEvent: vi.fn()
}));

vi.mock('../../src/config/redis', () => ({
  __esModule: true,
  default: {
    set: vi.fn(() => Promise.resolve('OK')),
    del: vi.fn(() => Promise.resolve(1))
  }
}));

import type {
  SessionRecord,
  SessionRepository
} from '../../src/modules/researcher/aliexpress.session';
import type { AliExpressTokenResult } from '../../src/modules/researcher/aliexpress.oauth';

function normalizeSession(
  initial: Pick<SessionRecord, 'accessToken'> & Partial<SessionRecord>
): SessionRecord {
  return {
    accessToken: initial.accessToken,
    refreshToken: initial.refreshToken ?? null,
    expiresAt: initial.expiresAt ?? null,
    refreshExpiresAt: initial.refreshExpiresAt ?? null,
    refreshIneligible: initial.refreshIneligible ?? false
  };
}

function makeRepo(initial: Pick<SessionRecord, 'accessToken'> & Partial<SessionRecord>): {
  repo: SessionRepository;
  reads: number;
  writes: SessionRecord[];
} {
  const writes: SessionRecord[] = [];
  let reads = 0;
  let current = normalizeSession(initial);
  const repo: SessionRepository = {
    read(): Promise<SessionRecord> {
      reads += 1;
      return Promise.resolve(current);
    },
    write(record: SessionRecord): Promise<void> {
      writes.push(record);
      current = record;
      return Promise.resolve();
    }
  };
  return {
    repo,
    get reads() {
      return reads;
    },
    writes
  };
}

const fixedNow = new Date('2026-01-01T00:00:00Z');
const clock = { now: () => fixedNow };

describe('getValidAliExpressSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the existing access token when expiry is far in the future', async () => {
    const { getValidAliExpressSession } = await import(
      '../../src/modules/researcher/aliexpress.session'
    );
    const farFuture = new Date(fixedNow.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { repo } = makeRepo({
      accessToken: 'STILL_VALID',
      refreshToken: 'R',
      expiresAt: farFuture
    });
    const refresh = vi.fn();

    const out = await getValidAliExpressSession({ repo, refresh, clock });

    expect(out).toBe('STILL_VALID');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes when expiry is within the threshold (default 24h)', async () => {
    const { getValidAliExpressSession } = await import(
      '../../src/modules/researcher/aliexpress.session'
    );
    const inOneHour = new Date(fixedNow.getTime() + 60 * 60 * 1000);
    const { repo, writes } = makeRepo({
      accessToken: 'ALMOST_EXPIRED',
      refreshToken: 'GOOD_REFRESH',
      expiresAt: inOneHour
    });

    const refresh = vi.fn(
      async (rt: string): Promise<AliExpressTokenResult> => {
        expect(rt).toBe('GOOD_REFRESH');
        return {
          accessToken: 'BRAND_NEW',
          refreshToken: 'BRAND_NEW_REFRESH',
          expiresIn: 86_400,
          refreshExpiresIn: 2_592_000,
          sellerId: null,
          userNick: null,
          raw: {}
        };
      }
    );

    const out = await getValidAliExpressSession({ repo, refresh, clock });

    expect(out).toBe('BRAND_NEW');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.accessToken).toBe('BRAND_NEW');
    expect(writes[0]?.refreshToken).toBe('BRAND_NEW_REFRESH');
    expect(writes[0]?.expiresAt?.getTime()).toBe(fixedNow.getTime() + 86_400 * 1000);
    expect(writes[0]?.refreshExpiresAt?.getTime()).toBe(fixedNow.getTime() + 2_592_000 * 1000);
  });

  it('refreshes when expiresAt is null (legacy / never-stored)', async () => {
    const { getValidAliExpressSession } = await import(
      '../../src/modules/researcher/aliexpress.session'
    );
    const { repo } = makeRepo({
      accessToken: 'LEGACY',
      refreshToken: 'R',
      expiresAt: null
    });
    const refresh = vi.fn(
      async (): Promise<AliExpressTokenResult> => ({
        accessToken: 'NEW',
        refreshToken: 'NEW_R',
        expiresIn: 86_400,
        refreshExpiresIn: null,
        sellerId: null,
        userNick: null,
        raw: {}
      })
    );

    const out = await getValidAliExpressSession({ repo, refresh, clock });
    expect(out).toBe('NEW');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('throws when token is expired AND no refresh_token is available', async () => {
    const { getValidAliExpressSession } = await import(
      '../../src/modules/researcher/aliexpress.session'
    );
    const yesterday = new Date(fixedNow.getTime() - 24 * 60 * 60 * 1000);
    const { repo } = makeRepo({
      accessToken: 'EXPIRED',
      refreshToken: null,
      expiresAt: yesterday
    });
    const refresh = vi.fn();

    await expect(
      getValidAliExpressSession({ repo, refresh, clock })
    ).rejects.toThrow(/refresh token/i);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('throws when no session has ever been stored', async () => {
    const { getValidAliExpressSession } = await import(
      '../../src/modules/researcher/aliexpress.session'
    );
    const { repo } = makeRepo({
      accessToken: '',
      refreshToken: null,
      expiresAt: null
    });
    const refresh = vi.fn();

    await expect(
      getValidAliExpressSession({ repo, refresh, clock })
    ).rejects.toThrow(/OAuth.*\/auth\/aliexpress/);
  });

  it('honors a custom refreshThresholdMs', async () => {
    const { getValidAliExpressSession } = await import(
      '../../src/modules/researcher/aliexpress.session'
    );
    const inTwoHours = new Date(fixedNow.getTime() + 2 * 60 * 60 * 1000);
    const { repo } = makeRepo({
      accessToken: 'NOT_REFRESHED',
      refreshToken: 'R',
      expiresAt: inTwoHours
    });
    const refresh = vi.fn();

    const out = await getValidAliExpressSession({
      repo,
      refresh,
      clock,
      refreshThresholdMs: 60 * 60 * 1000 // 1 hour — token expires in 2h, no refresh
    });

    expect(out).toBe('NOT_REFRESHED');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('throws when refresh window is past (no API call)', async () => {
    const { getValidAliExpressSession } = await import(
      '../../src/modules/researcher/aliexpress.session'
    );
    const { repo } = makeRepo({
      accessToken: 'OLD',
      refreshToken: 'R',
      expiresAt: new Date(fixedNow.getTime() - 1000),
      refreshExpiresAt: new Date(fixedNow.getTime() - 60_000)
    });
    const refresh = vi.fn();

    await expect(getValidAliExpressSession({ repo, refresh, clock })).rejects.toThrow(
      /refresh token is expired or refresh is disabled/
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('throws when refresh_expires_in was 0 (ineligible)', async () => {
    const { getValidAliExpressSession } = await import(
      '../../src/modules/researcher/aliexpress.session'
    );
    const { repo } = makeRepo({
      accessToken: 'OK',
      refreshToken: 'R',
      expiresAt: new Date(fixedNow.getTime() + 60 * 1000),
      refreshIneligible: true
    });
    const refresh = vi.fn();

    await expect(getValidAliExpressSession({ repo, refresh, clock })).rejects.toThrow(
      /refresh is disabled/
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
