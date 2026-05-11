import { Router } from 'express';
import { query } from '../../config/db';

export const eventsRouter = Router();

eventsRouter.get('/', async (req, res, next) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const once = req.query.once === '1';

    const sendLatest = async (): Promise<void> => {
      const rows = await query<Record<string, unknown>>(
        'SELECT * FROM pipeline_events ORDER BY created_at DESC LIMIT 10'
      );
      for (const row of rows) {
        res.write(`data: ${JSON.stringify(row)}\n\n`);
      }
    };

    await sendLatest();

    if (once) {
      res.end();
      return;
    }

    const timer = setInterval(() => {
      void sendLatest();
    }, 2000);

    req.on('close', () => {
      clearInterval(timer);
      res.end();
    });
  } catch (e: unknown) {
    next(e);
  }
});
