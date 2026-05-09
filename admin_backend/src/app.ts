import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorMiddleware } from './lib/httpErrors.js';
import { requestContextMiddleware, requestLoggingMiddleware } from './lib/observability.js';
import { initSentry, sentryErrorHandler } from './lib/sentry.js';
import { apiRouter } from './routes/index.js';
import { webhookRouter } from './routes/webhooks.js';

export const CORS_ALLOWED_HEADERS = [
  'content-type',
  'x-csrf-token',
  'idempotency-key',
  'sentry-trace',
  'baggage',
];

export const createCorsOriginDelegate = (allowedOrigins: string[]) => {
  const allowedOriginSet = new Set(allowedOrigins);

  return (
    origin: string | undefined,
    callback: (error: Error | null, origin?: boolean | string) => void
  ) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    callback(null, allowedOriginSet.has(origin) ? origin : false);
  };
};

export const createApp = () => {
  initSentry();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use(requestContextMiddleware);
  app.use(requestLoggingMiddleware);
  app.use(
    helmet({
      // CSP is enforced by the admin frontend and deployment edge. Keep API JSON routes compatible.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(
    cors({
      allowedHeaders: CORS_ALLOWED_HEADERS,
      credentials: true,
      exposedHeaders: ['content-disposition'],
      origin: createCorsOriginDelegate(env.PUBLIC_ADMIN_WEB_ORIGINS),
    })
  );
  app.use('/api/v1/webhooks', webhookRouter);
  app.use(express.json({ limit: env.ADMIN_JSON_BODY_LIMIT }));
  app.use('/api', apiRouter);
  app.use(sentryErrorHandler());
  app.use(errorMiddleware);

  return app;
};
