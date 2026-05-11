import cron, { type ScheduledTask } from 'node-cron';
import redisClient from '../config/redis';
import { env } from '../config/env';
import logger, { logPipelineEvent } from '../shared/logger';
import { runAliExpressReauthAlertCheck } from '../modules/notify/aliexpress-reauth-alert';
import { amazonScrapeQueue, tiktokScrapeQueue } from './pipeline.queue';

/**
 * Starts cron schedules (scrapers + optional AliExpress re-auth reminders).
 *
 * Call `.stop()` on each returned task during graceful shutdown.
 */
export async function startScheduler(): Promise<ScheduledTask[]> {
  const tasks: ScheduledTask[] = [];

  tasks.push(
    cron.schedule(env.SCRAPER_CRON, async () => {
      await triggerManually();
    })
  );

  await logPipelineEvent({
    stage: 'scheduler',
    status: 'ok',
    message: `scheduler started (${env.SCRAPER_CRON})`
  });

  const reauthCron = env.REAUTH_ALERT_CRON.trim();
  if (reauthCron.length > 0) {
    try {
      tasks.push(
        cron.schedule(reauthCron, async () => {
          try {
            await runAliExpressReauthAlertCheck();
          } catch (e: unknown) {
            logger.warn('reauth alert cron failed', {
              detail: e instanceof Error ? e.message : String(e)
            });
          }
        })
      );
      await logPipelineEvent({
        stage: 'scheduler',
        status: 'ok',
        message: `AliExpress re-auth alert cron registered (${reauthCron})`
      });
    } catch (e: unknown) {
      logger.warn('invalid REAUTH_ALERT_CRON — skipping', {
        cron: reauthCron,
        detail: e instanceof Error ? e.message : String(e)
      });
    }
  }

  return tasks;
}

/**
 * Triggers the daily scrape run on demand.
 */
export async function triggerManually(): Promise<void> {
  const enabled = await redisClient.get('pipeline:enabled');
  const enabledBool =
    enabled === null ? true : !(enabled === '0' || enabled === 'false');

  if (!enabledBool) {
    await logPipelineEvent({
      stage: 'scheduler',
      status: 'warn',
      message: 'pipeline disabled by kill switch'
    });
    return;
  }

  const triggeredAt = new Date().toISOString();
  const [tiktokJob, amazonJob] = await Promise.all([
    tiktokScrapeQueue.add('tiktok-scrape', { triggeredAt }),
    amazonScrapeQueue.add('amazon-scrape', { triggeredAt })
  ]);

  await logPipelineEvent({
    stage: 'scheduler',
    status: 'ok',
    message: 'scheduled scraper jobs',
    payload: { tiktokJobId: tiktokJob.id, amazonJobId: amazonJob.id, triggeredAt }
  });
}