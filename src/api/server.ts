import express, { type Express, type RequestHandler } from 'express';
import http from 'node:http';
import cors from 'cors';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { env } from '../config/env';
import logger from '../shared/logger';
import { query } from '../config/db';
import { errorMiddleware } from './middleware/error.middleware';
import { authMiddleware } from './middleware/auth.middleware';
import { metricsRouter } from './routes/metrics.routes';
import { productsRouter } from './routes/products.routes';
import { settingsRouter } from './routes/settings.routes';
import { eventsRouter } from './routes/events.routes';
import { analyticsRouter } from './routes/analytics.routes';
import { webhooksRouter } from './routes/webhooks.routes';
import { adminRouter } from './routes/admin.routes';
import { healthRouter } from './routes/health.routes';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import crypto from 'node:crypto';
import redisClient from '../config/redis';
import {
  exchangeShopifyOAuthCode,
  setShopifyAccessToken,
  verifyShopifyQueryHmac
} from '../modules/publisher/shopify.token';
import {
  buildAliExpressAuthorizeUrl,
  exchangeAliExpressOAuthCode,
  randomState
} from '../modules/researcher/aliexpress.oauth';

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0.1
  });
}

/**
 * Creates the Express app for the dashboard API.
 */
export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(healthRouter);

  // ngrok free tier can show a browser interstitial unless a special query param/header is present.
  // Shopify loads embedded apps in an iframe and we can't control request headers, so redirect to add the param.
  app.use((req, res, next) => {
    if (env.NODE_ENV !== 'development') return next();
    const host = (req.header('host') ?? '').toLowerCase();
    if (!host.endsWith('ngrok-free.dev')) return next();
    if (typeof req.query['ngrok-skip-browser-warning'] === 'string') return next();

    const url = new URL(`${req.protocol}://${host}${req.originalUrl}`);
    url.searchParams.set('ngrok-skip-browser-warning', '1');
    res.redirect(302, url.toString());
  });

  // Basic landing endpoints (Shopify loads embedded apps with a signed querystring).
  app.get('/', async (req, res) => {
    const shop = typeof req.query.shop === 'string' ? req.query.shop : '';
    const hasHmac = typeof req.query.hmac === 'string';

    // If Shopify is loading the app and OAuth is configured, make sure we have a token.
    if (shop && hasHmac && env.SHOPIFY_API_KEY && env.SHOPIFY_API_SECRET && env.PUBLIC_URL) {
      const ok = verifyShopifyQueryHmac({
        apiSecret: env.SHOPIFY_API_SECRET,
        query: req.query as Record<string, string | string[] | undefined>
      });
      if (ok) {
        const rows = await query<{ value: string }>(
          'SELECT value FROM pipeline_config WHERE key = $1 LIMIT 1',
          ['shopify_admin_access_token']
        );
        const token = rows[0]?.value?.trim() ?? '';
        if (!token) {
          res.redirect(302, `/auth/install?shop=${encodeURIComponent(shop)}`);
          return;
        }
      }
    }

    res.status(200).send('ok');
  });

  app.get('/auth/install', async (req, res) => {
    const shop = typeof req.query.shop === 'string' ? req.query.shop : '';
    if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET || !env.PUBLIC_URL) {
      res.status(500).json({ error: 'oauth_not_configured' });
      return;
    }
    if (!shop.endsWith('.myshopify.com')) {
      res.status(400).json({ error: 'invalid_shop' });
      return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    await redisClient.set(`shopify:oauth:state:${state}`, shop, 'EX', 600);
    const scopes = ['write_products', 'read_products'].join(',');
    const redirectUri = `${env.PUBLIC_URL.replace(/\/+$/, '')}/auth/callback`;

    const authorizeUrl =
      `https://${shop}/admin/oauth/authorize` +
      `?client_id=${encodeURIComponent(env.SHOPIFY_API_KEY)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`;

    res.redirect(302, authorizeUrl);
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      const shop = typeof req.query.shop === 'string' ? req.query.shop : '';
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';

      if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET || !env.PUBLIC_URL) {
        res.status(500).json({ error: 'oauth_not_configured' });
        return;
      }
      if (!shop || !code) {
        res.status(400).json({ error: 'missing_params' });
        return;
      }

      const ok = verifyShopifyQueryHmac({
        apiSecret: env.SHOPIFY_API_SECRET,
        query: req.query as Record<string, string | string[] | undefined>
      });
      if (!ok) {
        res.status(401).json({ error: 'invalid_hmac' });
        return;
      }

      // In development, be resilient to stale/expired state caused by Redis restarts, refreshes, and tunnel flakiness.
      // If HMAC is valid, we can safely complete the exchange. If state exists, still validate & delete it.
      if (state) {
        const expectedShop = await redisClient.get(`shopify:oauth:state:${state}`);
        if (expectedShop && expectedShop !== shop) {
          res.status(400).json({ error: 'invalid_state' });
          return;
        }
        if (expectedShop) {
          await redisClient.del(`shopify:oauth:state:${state}`);
        } else if (env.NODE_ENV !== 'development') {
          res.status(400).json({ error: 'invalid_state' });
          return;
        } else {
          logger.warn('shopify oauth state missing/expired; continuing due to valid hmac (dev mode)', {
            shop
          });
        }
      } else if (env.NODE_ENV !== 'development') {
        res.status(400).json({ error: 'missing_state' });
        return;
      }

      const accessToken = await exchangeShopifyOAuthCode({ shop, code });
      await setShopifyAccessToken({ shop, accessToken });

      res.status(200).send('ok');
    } catch {
      res.status(500).json({ error: 'oauth_failed' });
    }
  });

  /**
   * AliExpress (Taobao Open Platform) OAuth (for AE-Dropshipper APIs).
   */
  app.get('/auth/aliexpress', async (_req, res) => {
    if (!env.PUBLIC_URL) {
      res.status(500).json({ error: 'public_url_missing' });
      return;
    }
    const redirectUri = `${env.PUBLIC_URL.replace(/\/+$/, '')}/auth/aliexpress/callback`;
    const state = randomState();
    await redisClient.set(`aliexpress:oauth:state:${state}`, '1', 'EX', 600);
    const authorizeUrl = buildAliExpressAuthorizeUrl({ redirectUri, state });

    logger.info('aliexpress oauth authorize url', { authorizeUrl });
    res.redirect(302, authorizeUrl);
  });

  app.get('/auth/aliexpress/callback', async (req, res) => {
    try {
      if (!env.PUBLIC_URL) {
        res.status(500).json({ error: 'public_url_missing' });
        return;
      }
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      if (!code) {
        res.status(400).json({ error: 'missing_code' });
        return;
      }

      // Validate state (development tolerant).
      if (state) {
        const ok = await redisClient.get(`aliexpress:oauth:state:${state}`);
        if (ok) {
          await redisClient.del(`aliexpress:oauth:state:${state}`);
        } else if (env.NODE_ENV !== 'development') {
          res.status(400).json({ error: 'invalid_state' });
          return;
        } else {
          logger.warn('aliexpress oauth state missing/expired; continuing (dev mode)');
        }
      } else if (env.NODE_ENV !== 'development') {
        res.status(400).json({ error: 'missing_state' });
        return;
      }

      const redirectUri = `${env.PUBLIC_URL.replace(/\/+$/, '')}/auth/aliexpress/callback`;
      const tokenResult = await exchangeAliExpressOAuthCode({ code, redirectUri });

      const upsert = async (key: string, value: string): Promise<void> => {
        await query(
          `INSERT INTO pipeline_config(key, value)
           VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, value]
        );
      };

      await upsert('aliexpress_session_key', tokenResult.accessToken);
      if (tokenResult.refreshToken) {
        await upsert('aliexpress_refresh_token', tokenResult.refreshToken);
      }
      if (tokenResult.expiresIn !== null && tokenResult.expiresIn > 0) {
        const expiresAt = new Date(Date.now() + tokenResult.expiresIn * 1000).toISOString();
        await upsert('aliexpress_session_expires_at', expiresAt);
      }
      // Per AliExpress docs: when refresh_expires_in is 0, access may work until expiry but refresh is not allowed.
      if (tokenResult.refreshExpiresIn !== null && tokenResult.refreshExpiresIn > 0) {
        const refreshExp = new Date(Date.now() + tokenResult.refreshExpiresIn * 1000).toISOString();
        await upsert('aliexpress_refresh_expires_at', refreshExp);
      } else {
        await query(`DELETE FROM pipeline_config WHERE key = $1`, ['aliexpress_refresh_expires_at']);
      }
      if (tokenResult.refreshExpiresIn === 0) {
        await upsert('aliexpress_refresh_ineligible', '1');
      } else {
        await query(`DELETE FROM pipeline_config WHERE key = $1`, ['aliexpress_refresh_ineligible']);
      }

      logger.info('aliexpress oauth complete', {
        sellerId: tokenResult.sellerId,
        userNick: tokenResult.userNick,
        expiresIn: tokenResult.expiresIn,
        refreshExpiresIn: tokenResult.refreshExpiresIn
      });
      res
        .status(200)
        .send(
          `AliExpress OAuth complete${
            tokenResult.userNick ? ` (seller: ${tokenResult.userNick})` : ''
          }. You can close this tab.`
        );
    } catch (e: unknown) {
      logger.error('aliexpress oauth failed', { error: String(e) });
      res.status(500).json({ error: 'oauth_failed', detail: String(e) });
    }
  });

  // Webhooks must use raw body for HMAC verification.
  app.use('/webhooks', express.raw({ type: 'application/json', limit: '2mb' }));
  app.use(express.json({ limit: '1mb' }));

  // SSE: EventSource cannot send Authorization; keep this path before bearer auth.
  app.use('/api/events', eventsRouter);

  app.use('/api', authMiddleware);

  app.use('/api/metrics', metricsRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/webhooks', webhooksRouter);

  if (env.NODE_ENV !== 'test') {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    // Defer importing queues so unit tests don't touch Redis/BullMQ.
    void import('../queues/pipeline.queue').then((queues) => {
      createBullBoard({
        queues: [
          new BullMQAdapter(queues.tiktokScrapeQueue),
          new BullMQAdapter(queues.amazonScrapeQueue),
          new BullMQAdapter(queues.mergeProductsQueue),
          new BullMQAdapter(queues.researchSuppliersQueue),
          new BullMQAdapter(queues.generateContentQueue),
          new BullMQAdapter(queues.publishProductQueue),
          new BullMQAdapter(queues.forwardOrderQueue)
        ],
        serverAdapter
      });
    });

    app.use(
      '/admin/queues',
      authMiddleware,
      serverAdapter.getRouter() as unknown as RequestHandler
    );
  }

  app.use(errorMiddleware);
  return app;
}

/**
 * Starts the HTTP server. Returns the listener for graceful shutdown.
 */
export function startServer(): http.Server {
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info('api server listening', { port: env.PORT });
    if (env.PUBLIC_URL) {
      logger.info('aliexpress oauth start', {
        url: `${env.PUBLIC_URL.replace(/\/+$/, '')}/auth/aliexpress`
      });
    }
  });
  return server;
}
