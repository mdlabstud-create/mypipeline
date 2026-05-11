import logger from '../../shared/logger';
import { query } from '../../config/db';
import redisClient from '../../config/redis';
import { env } from '../../config/env';
import {
  refreshAliExpressOAuthToken,
  type AliExpressTokenResult
} from './aliexpress.oauth';

const REFRESH_LOCK_KEY = 'pipeline:aliexpress:oauth-refresh';
const REFRESH_LOCK_TTL_SEC = 45;
const LOCK_WAIT_MS = 40_000;
const LOCK_POLL_MS = 200;

/**
 * Persisted AliExpress OAuth state.
 *
 * `accessToken` may be empty when no OAuth handshake has ever completed.
 * `refreshToken` may be null for the same reason or for legacy installations.
 * `expiresAt` may be null for legacy installations that pre-date this module.
 *
 * `refreshExpiresAt` — absolute wall time after which AliExpress will reject
 * `/auth/token/refresh` (per Open Platform docs; refresh lifetime does not reset).
 *
 * `refreshIneligible` — when the token payload had `refresh_expires_in === 0`,
 * access may work until expiry but refresh is not allowed (re-auth only).
 */
export type SessionRecord = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  refreshExpiresAt: Date | null;
  refreshIneligible: boolean;
};

/**
 * Read/write boundary for the AliExpress session.
 *
 * Implementations are free to back this with Postgres, Redis, an env file, or
 * any other store. The `getValidAliExpressSession` orchestrator only needs
 * read/write semantics, which keeps the refresh logic free of I/O for testing.
 */
export type SessionRepository = {
  read(): Promise<SessionRecord>;
  write(record: SessionRecord): Promise<void>;
};

export type Clock = { now(): Date };

const DEFAULT_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

const realClock: Clock = { now: () => new Date };

function authHint(): string {
  const base = env.PUBLIC_URL?.replace(/\/+$/, '') ?? '';
  return base.length > 0 ? `${base}/auth/aliexpress` : '/auth/aliexpress';
}

function accessNeedsRefresh(
  record: SessionRecord,
  now: Date,
  thresholdMs: number
): boolean {
  if (!record.expiresAt) return true;
  return record.expiresAt.getTime() - now.getTime() < thresholdMs;
}

function refreshTokenUnusable(record: SessionRecord, now: Date): boolean {
  if (record.refreshIneligible) return true;
  if (
    record.refreshExpiresAt &&
    !Number.isNaN(record.refreshExpiresAt.getTime()) &&
    record.refreshExpiresAt.getTime() <= now.getTime()
  ) {
    return true;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Returns a guaranteed-fresh AliExpress access token, transparently refreshing
 * via the refresh_token grant when the stored access_token is within
 * `refreshThresholdMs` of expiry.
 *
 * Uses a short Redis lock so concurrent workers do not rotate the refresh token
 * under each other (a common cause of IllegalRefreshToken flakiness).
 *
 * Throws when no session has ever been stored, or when refresh is required but
 * impossible — both cases require human re-authorization at `/auth/aliexpress`.
 */
export async function getValidAliExpressSession(deps: {
  repo: SessionRepository;
  refresh: (refreshToken: string) => Promise<AliExpressTokenResult>;
  clock?: Clock;
  refreshThresholdMs?: number;
}): Promise<string> {
  const { repo, refresh } = deps;
  const clock = deps.clock ?? realClock;
  const threshold = deps.refreshThresholdMs ?? DEFAULT_REFRESH_THRESHOLD_MS;

  const current = await repo.read();
  if (!current.accessToken || current.accessToken.trim() === '') {
    throw new Error(
      `AliExpress session missing — complete OAuth at ${authHint()} before researching products.`
    );
  }

  const now = clock.now();

  if (!accessNeedsRefresh(current, now, threshold)) {
    return current.accessToken;
  }

  if (!current.refreshToken) {
    throw new Error(
      `AliExpress access token is near/past expiry and no refresh token is stored — reauthorize at ${authHint()}.`
    );
  }

  if (refreshTokenUnusable(current, now)) {
    throw new Error(
      `AliExpress refresh token is expired or refresh is disabled (refresh_expires_in was 0). Re-authorize at ${authHint()}.`
    );
  }

  const gotLock = await redisClient.set(
    REFRESH_LOCK_KEY,
    '1',
    'EX',
    REFRESH_LOCK_TTL_SEC,
    'NX'
  );

  if (gotLock !== 'OK') {
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(LOCK_POLL_MS);
      const latest = await repo.read();
      const t = clock.now();
      if (!accessNeedsRefresh(latest, t, threshold)) {
        return latest.accessToken;
      }
      if (!latest.refreshToken || refreshTokenUnusable(latest, t)) {
        throw new Error(
          `AliExpress session became invalid while waiting for refresh. Re-authorize at ${authHint()}.`
        );
      }
    }
    throw new Error(
      `Timed out waiting for another worker to refresh AliExpress tokens. Retry or re-authorize at ${authHint()}.`
    );
  }

  try {
    let cur = await repo.read();
    const t0 = clock.now();
    if (!accessNeedsRefresh(cur, t0, threshold)) return cur.accessToken;
    if (!cur.refreshToken || refreshTokenUnusable(cur, t0)) {
      throw new Error(
        `AliExpress refresh no longer possible. Re-authorize at ${authHint()}.`
      );
    }

    logger.info('aliexpress session refresh starting', {
      expiresAt: cur.expiresAt?.toISOString() ?? null,
      refreshExpiresAt: cur.refreshExpiresAt?.toISOString() ?? null,
      thresholdMs: threshold
    });

    const fresh = await refresh(cur.refreshToken);
    const t1 = clock.now();

    const newExpiresAt =
      fresh.expiresIn !== null && fresh.expiresIn > 0
        ? new Date(t1.getTime() + fresh.expiresIn * 1000)
        : null;

    let newRefreshExpiresAt: Date | null = null;
    let refreshIneligible = false;
    if (fresh.refreshExpiresIn !== null && fresh.refreshExpiresIn <= 0) {
      refreshIneligible = true;
    } else if (fresh.refreshExpiresIn !== null && fresh.refreshExpiresIn > 0) {
      newRefreshExpiresAt = new Date(t1.getTime() + fresh.refreshExpiresIn * 1000);
    } else {
      newRefreshExpiresAt = cur.refreshExpiresAt;
    }

    const next: SessionRecord = {
      accessToken: fresh.accessToken,
      refreshToken: fresh.refreshToken ?? cur.refreshToken,
      expiresAt: newExpiresAt,
      refreshExpiresAt: newRefreshExpiresAt,
      refreshIneligible
    };

    await repo.write(next);

    logger.info('aliexpress session refreshed', {
      expiresAt: newExpiresAt?.toISOString() ?? null,
      refreshExpiresAt: newRefreshExpiresAt?.toISOString() ?? null,
      refreshIneligible,
      refreshTokenRotated:
        fresh.refreshToken !== null && fresh.refreshToken !== cur.refreshToken
    });

    return next.accessToken;
  } finally {
    try {
      await redisClient.del(REFRESH_LOCK_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Default `SessionRepository` backed by the `pipeline_config` key/value table.
 *
 * Storage keys:
 *  - `aliexpress_session_key`           → access token
 *  - `aliexpress_refresh_token`         → refresh token
 *  - `aliexpress_session_expires_at`    → ISO-8601 access-token expiry
 *  - `aliexpress_refresh_expires_at`    → ISO-8601 refresh-token expiry (optional)
 *  - `aliexpress_refresh_ineligible`    → "1" when refresh_expires_in was 0
 */
export function createPipelineConfigSessionRepository(): SessionRepository {
  return {
    async read(): Promise<SessionRecord> {
      const rows = await query<{ key: string; value: string }>(
        `SELECT key, value FROM pipeline_config WHERE key IN ($1, $2, $3, $4, $5)`,
        [
          'aliexpress_session_key',
          'aliexpress_refresh_token',
          'aliexpress_session_expires_at',
          'aliexpress_refresh_expires_at',
          'aliexpress_refresh_ineligible'
        ]
      );
      const map = new Map(rows.map((r) => [r.key, r.value]));
      const expiresRaw = map.get('aliexpress_session_expires_at');
      const refreshExpRaw = map.get('aliexpress_refresh_expires_at');
      const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
      const refreshExpiresAt = refreshExpRaw ? new Date(refreshExpRaw) : null;
      return {
        accessToken: (map.get('aliexpress_session_key') ?? '').trim(),
        refreshToken: (map.get('aliexpress_refresh_token') ?? '').trim() || null,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        refreshExpiresAt:
          refreshExpiresAt && !Number.isNaN(refreshExpiresAt.getTime())
            ? refreshExpiresAt
            : null,
        refreshIneligible: map.get('aliexpress_refresh_ineligible') === '1'
      };
    },

    async write(record: SessionRecord): Promise<void> {
      if (!record.refreshIneligible) {
        await query(`DELETE FROM pipeline_config WHERE key = $1`, ['aliexpress_refresh_ineligible']);
      }
      if (!record.refreshExpiresAt) {
        await query(`DELETE FROM pipeline_config WHERE key = $1`, ['aliexpress_refresh_expires_at']);
      }

      const upserts: Array<[string, string]> = [
        ['aliexpress_session_key', record.accessToken]
      ];
      if (record.refreshToken) {
        upserts.push(['aliexpress_refresh_token', record.refreshToken]);
      }
      if (record.expiresAt) {
        upserts.push(['aliexpress_session_expires_at', record.expiresAt.toISOString()]);
      }
      if (record.refreshExpiresAt) {
        upserts.push(['aliexpress_refresh_expires_at', record.refreshExpiresAt.toISOString()]);
      }
      if (record.refreshIneligible) {
        upserts.push(['aliexpress_refresh_ineligible', '1']);
      }

      for (const [key, value] of upserts) {
        await query(
          `INSERT INTO pipeline_config(key, value)
           VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, value]
        );
      }
    }
  };
}

/**
 * Convenience: returns a fresh AliExpress access token using the default
 * Postgres-backed repository and the real refresh-grant flow.
 *
 * Lead time before access expiry is controlled by `ALIEXPRESS_ACCESS_REFRESH_LEAD_MS`.
 */
export async function getFreshAliExpressSession(): Promise<string> {
  return getValidAliExpressSession({
    repo: createPipelineConfigSessionRepository(),
    refresh: (rt) => refreshAliExpressOAuthToken({ refreshToken: rt }),
    refreshThresholdMs: env.ALIEXPRESS_ACCESS_REFRESH_LEAD_MS
  });
}
