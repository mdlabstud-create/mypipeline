import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('@sentry/node', () => {
  return {
    init: vi.fn(),
    captureException: vi.fn()
  };
});

describe('sentry capture', () => {
  it('captures exception when SENTRY_DSN set', async () => {
    process.env.SENTRY_DSN = 'https://example@dsn.ingest.sentry.io/123';
    process.env.NODE_ENV = 'test';

    const { errorMiddleware } = await import('../../src/api/middleware/error.middleware');
    const Sentry = await import('@sentry/node');

    const res = {
      status: () => res,
      json: () => undefined
    };

    errorMiddleware(
      new Error('boom'),
      {} as Request,
      res as unknown as Response,
      (() => undefined) as NextFunction
    );

    expect(Sentry.captureException).toHaveBeenCalled();
  });
});

