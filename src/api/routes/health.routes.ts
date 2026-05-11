import { Router } from 'express';
import { query } from '../../config/db';
import redisClient from '../../config/redis';

export const healthRouter = Router();

/**
 * Liveness: process is running (use for LB / orchestrator probes).
 */
healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'dropship-pipeline' });
});

/**
 * Readiness: PostgreSQL + Redis reachable (optional stricter probe for rollout).
 */
healthRouter.get('/ready', async (_req, res) => {
  try {
    await query('SELECT 1');
    const pong = await redisClient.ping();
    if (pong !== 'PONG') {
      res.status(503).json({ ok: false, reason: 'redis_ping_unexpected', detail: pong });
      return;
    }
    res.status(200).json({ ok: true, postgres: true, redis: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(503).json({ ok: false, reason: 'dependency_unreachable', detail: message });
  }
});
