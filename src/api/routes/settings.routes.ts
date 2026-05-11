import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db';

export const settingsRouter = Router();

const SettingsUpdateSchema = z.object({
  markupMultiplier: z.number().min(1.5).max(5.0).optional()
});

settingsRouter.put('/', async (req, res, next) => {
  try {
    const parsed = SettingsUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }

    const updates = parsed.data;
    for (const [key, value] of Object.entries(updates)) {
      await query(
        `INSERT INTO pipeline_config (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [key, String(value)]
      );
    }

    const rows = await query<{ key: string; value: string }>(
      'SELECT key, value FROM pipeline_config ORDER BY key'
    );
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  } catch (e: unknown) {
    next(e);
  }
});

settingsRouter.get('/', async (_req, res, next) => {
  try {
    const rows = await query<{ key: string; value: string }>(
      'SELECT key, value FROM pipeline_config ORDER BY key'
    );
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  } catch (e: unknown) {
    next(e);
  }
});
