import type { NextFunction, Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { env } from '../../config/env';
import logger from '../../shared/logger';

/**
 * Global error handler for the API.
 */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  void _next;
  logger.error('api error', { err });
  if (env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  res.status(500).json({ error: 'internal_error' });
}
