import type { Server } from 'node:http';
import type { Worker } from 'bullmq';
import type { ScheduledTask } from 'node-cron';
import { pool } from './config/db';
import { startScheduler } from './queues/scheduler';
import { startAllWorkers } from './queues/workers';
import redisClient from './config/redis';
import { env } from './config/env';
import logger from './shared/logger';
import { startServer } from './api/server';

/** Hold references so SIGTERM/SIGINT can drain gracefully. */
let httpServer: Server | undefined;
let workers: Worker[] = [];
let schedulerTasks: ScheduledTask[] = [];
let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('shutdown initiated', { signal });

  await Promise.all(schedulerTasks.map((t) => Promise.resolve(t.stop())));

  await Promise.allSettled(
    workers.map(async (worker) => {
      try {
        await worker.close();
      } catch (e: unknown) {
        logger.warn('worker close error', {
          queue: worker.name,
          detail: e instanceof Error ? e.message : String(e)
        });
      }
    })
  );

  if (httpServer) {
    await new Promise<void>((resolve, reject) => {
      httpServer!.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    }).catch((e: unknown) => {
      logger.warn('http close error', { detail: String(e) });
    });
  }

  try {
    await pool.end();
  } catch (e: unknown) {
    logger.warn('postgres pool end error', { detail: String(e) });
  }

  try {
    await redisClient.quit();
  } catch {
    redisClient.disconnect();
  }

  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

/**
 * Entry point for the Dropship Pipeline app.
 */
async function main(): Promise<void> {
  try {
    // Warm Redis without calling connect() twice: BullMQ may open the shared
    // ioredis client during module load (queue construction).
    await redisClient.ping();

    if (!env.PIPELINE_ENABLED) {
      await redisClient.set('pipeline:enabled', '0');
      logger.warn('pipeline disabled by env', { key: 'pipeline:enabled' });
    } else {
      // Only initialize to '1' on a fresh Redis — preserves a deliberate kill-switch '0'.
      await redisClient.set('pipeline:enabled', '1', 'NX');
    }

    httpServer = startServer();
    workers = startAllWorkers();
    schedulerTasks = await startScheduler();
    logger.info('pipeline started');
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error('fatal startup error', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    } else {
      logger.error('fatal startup error', { error });
    }
    process.exit(1);
  }
}

void main();
