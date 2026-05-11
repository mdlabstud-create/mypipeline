import { Router } from 'express';
import { z } from 'zod';
import redisClient from '../../config/redis';
import { env } from '../../config/env';
import { triggerManually } from '../../queues/scheduler';
import { logPipelineEvent } from '../../shared/logger';
import { seedDemoData } from '../../modules/demo/demo.seed';

export const adminRouter = Router();

adminRouter.post('/trigger', async (_req, res, next) => {
  try {
    await triggerManually();
    res.status(200).json({ ok: true });
  } catch (e: unknown) {
    next(e);
  }
});

const DemoSeedSchema = z.object({
  count: z.number().int().min(1).max(10).optional()
});

adminRouter.post('/demo/seed', async (req, res, next) => {
  try {
    if (!env.DEMO_MODE) {
      res.status(403).json({ error: 'demo_mode_disabled' });
      return;
    }

    const parsed = DemoSeedSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const out = await seedDemoData(
      parsed.data.count !== undefined ? { count: parsed.data.count } : {}
    );
    res.status(200).json({ ok: true, ...out });
  } catch (e: unknown) {
    next(e);
  }
});

const ToggleSchema = z.object({
  enabled: z.boolean()
});

adminRouter.put('/pipeline/enabled', async (req, res, next) => {
  try {
    const parsed = ToggleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const value = parsed.data.enabled ? '1' : '0';
    await redisClient.set('pipeline:enabled', value);
    await logPipelineEvent({
      stage: 'admin',
      status: 'ok',
      message: 'pipeline enabled flag updated',
      payload: { enabled: parsed.data.enabled }
    });

    res.status(200).json({ ok: true, enabled: parsed.data.enabled });
  } catch (e: unknown) {
    next(e);
  }
});

