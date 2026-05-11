import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';

/**
 * Bearer token auth middleware.
 *
 * When API_BEARER_TOKEN is set, the Authorization header must match it exactly.
 * When unset, any valid bearer prefix passes (open dev mode).
 * Test env always bypasses.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (env.NODE_ENV === 'test') return next();

  const auth = req.header('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (env.API_BEARER_TOKEN) {
    const token = auth.slice(7); // strip "Bearer "
    if (token !== env.API_BEARER_TOKEN) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  }

  next();
}
