import axios from 'axios';
import redisClient from '../../config/redis';
import { query } from '../../config/db';
import { env } from '../../config/env';
import logger, { logPipelineEvent } from '../../shared/logger';

const COOLDOWN_KEY = 'pipeline:aliexpress_reauth_alert_cooldown';

function oauthStartUrl(): string | null {
  const base = env.PUBLIC_URL?.replace(/\/+$/, '') ?? '';
  if (!base) return null;
  return `${base}/auth/aliexpress`;
}

function emailConfigured(): boolean {
  return Boolean(
    env.RESEND_API_KEY?.trim() &&
      env.REAUTH_NOTIFY_EMAIL?.trim() &&
      env.REAUTH_EMAIL_FROM?.trim()
  );
}

function telegramConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_CHAT_ID?.trim());
}

async function readConfigValue(key: string): Promise<string | null> {
  const rows = await query<{ value: string }>(
    'SELECT value FROM pipeline_config WHERE key = $1 LIMIT 1',
    [key]
  );
  return rows[0]?.value?.trim() ?? null;
}

export type ReauthAlertReason = 'refresh_ineligible' | 'refresh_expiring' | 'missing_public_url';

/**
 * Returns whether we should remind the operator to complete AliExpress OAuth in the browser.
 */
export async function shouldSendAliExpressReauthAlert(): Promise<{
  should: boolean;
  reason: ReauthAlertReason | null;
  refreshExpiresAtIso: string | null;
}> {
  if (!oauthStartUrl()) {
    return { should: false, reason: 'missing_public_url', refreshExpiresAtIso: null };
  }

  const ineligible = await readConfigValue('aliexpress_refresh_ineligible');
  if (ineligible === '1') {
    return { should: true, reason: 'refresh_ineligible', refreshExpiresAtIso: null };
  }

  const refreshExpRaw = await readConfigValue('aliexpress_refresh_expires_at');
  if (!refreshExpRaw) {
    return { should: false, reason: null, refreshExpiresAtIso: null };
  }
  const refreshEnd = new Date(refreshExpRaw);
  if (Number.isNaN(refreshEnd.getTime())) {
    return { should: false, reason: null, refreshExpiresAtIso: null };
  }

  const leadMs = env.REAUTH_ALERT_LEAD_MS;
  const threshold = new Date(Date.now() + leadMs);
  if (refreshEnd <= threshold) {
    return { should: true, reason: 'refresh_expiring', refreshExpiresAtIso: refreshEnd.toISOString() };
  }

  return { should: false, reason: null, refreshExpiresAtIso: refreshEnd.toISOString() };
}

async function sendResendEmail(params: { to: string; from: string; subject: string; html: string }) {
  await axios.post(
    'https://api.resend.com/emails',
    {
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html
    },
    {
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30_000,
      validateStatus: () => true
    }
  ).then((res) => {
    if (res.status >= 200 && res.status < 300) return;
    const resData: unknown = res.data;
    logger.warn('Resend email non-success', { status: res.status, data: resData });
    throw new Error(`Resend HTTP ${res.status}`);
  });
}

async function sendTelegramMessage(text: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN!.trim();
  const chatId = env.TELEGRAM_CHAT_ID!.trim();
  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    { chat_id: chatId, text, disable_web_page_preview: false },
    { timeout: 30_000, validateStatus: () => true }
  ).then((res) => {
    const resData: unknown = res.data;
    if (
      resData &&
      typeof resData === 'object' &&
      'ok' in resData &&
      (resData as { ok?: boolean }).ok === false
    ) {
      logger.warn('telegram sendMessage rejected', { data: resData });
      throw new Error('Telegram API ok=false');
    }
    if (res.status >= 200 && res.status < 300) return;
    throw new Error(`Telegram HTTP ${res.status}`);
  });
}

/**
 * Cron entry: optionally email + Telegram when AliExpress re-auth will be needed soon.
 * Telegram will say an email was sent when Resend actually succeeds.
 */
export async function runAliExpressReauthAlertCheck(): Promise<void> {
  const url = oauthStartUrl();
  if (!url) {
    logger.debug('reauth alert skipped: PUBLIC_URL not set');
    return;
  }

  if (!telegramConfigured() && !emailConfigured()) {
    logger.debug('reauth alert skipped: no TELEGRAM_* or Resend email env');
    return;
  }

  const { should, reason, refreshExpiresAtIso } = await shouldSendAliExpressReauthAlert();
  if (!should || !reason || reason === 'missing_public_url') {
    return;
  }

  const cooldownSec = Math.max(60, Math.ceil(env.REAUTH_ALERT_COOLDOWN_MS / 1000));
  if (await redisClient.get(COOLDOWN_KEY)) {
    return;
  }

  let emailed = false;
  let telegramOk = false;
  if (emailConfigured()) {
    try {
      await sendResendEmail({
        to: env.REAUTH_NOTIFY_EMAIL!,
        from: env.REAUTH_EMAIL_FROM!,
        subject: 'AliExpress: re-authorization needed for dropship pipeline',
        html: `
          <p>Open this link on your computer or phone (log in to AliExpress and approve the app when asked):</p>
          <p><a href="${url}">${url}</a></p>
          ${
            refreshExpiresAtIso
              ? `<p>Stored refresh token expiry (UTC): ${refreshExpiresAtIso}</p>`
              : '<p>Note: refresh via API is disabled for this token until you re-authorize.</p>'
          }
          <p>Reason: ${reason}</p>
        `
      });
      emailed = true;
    } catch (e: unknown) {
      logger.warn('reauth alert: Resend email failed', {
        detail: e instanceof Error ? e.message : String(e)
      });
    }
  }

  if (telegramConfigured()) {
    try {
      const emailLine = emailed
        ? `An email was sent to ${env.REAUTH_NOTIFY_EMAIL} with the same link.`
        : emailConfigured()
          ? 'Email delivery failed or is misconfigured; open the link below manually.'
          : 'Open the link below (email notifications are not configured).';
      const expLine = refreshExpiresAtIso
        ? `\nRefresh expiry (UTC): ${refreshExpiresAtIso}`
        : '';
      const msg = `🔐 AliExpress re-auth needed (${reason}).\n${emailLine}\n\n${url}${expLine}`;
      await sendTelegramMessage(msg);
      telegramOk = true;
    } catch (e: unknown) {
      logger.warn('reauth alert: Telegram failed', {
        detail: e instanceof Error ? e.message : String(e)
      });
    }
  }

  if (!emailed && !telegramOk) {
    return;
  }

  await redisClient.set(COOLDOWN_KEY, '1', 'EX', cooldownSec);

  await logPipelineEvent({
    stage: 'aliexpress-reauth-alert',
    status: 'ok',
    message: 'reauth reminder sent',
    payload: { reason, emailed, telegram: telegramOk, refreshExpiresAtIso }
  });
}
