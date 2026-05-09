import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler } from './lib/httpErrors.js';
import { requestContextMiddleware, requestLoggingMiddleware } from './lib/observability.js';
import { initSentry, sentryErrorHandler } from './lib/sentry.js';
import { apiRouter } from './routes/index.js';

const captureWebhookRawBody = (request: unknown, _response: unknown, buffer: Buffer) => {
  const typedRequest = request as express.Request & { originalUrl?: unknown; url?: unknown };
  const url = String(typedRequest.originalUrl || typedRequest.url || '');

  if (url.includes('/webhooks/razorpay')) {
    typedRequest.rawBody = Buffer.from(buffer);
  }
};

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
      // CSP is expected to be enforced primarily at Nginx for the full platform.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(
    cors({
      allowedHeaders: CORS_ALLOWED_HEADERS,
      credentials: true,
      origin: createCorsOriginDelegate(env.PUBLIC_WEB_ORIGINS),
    })
  );
  app.use(express.json({ limit: env.API_JSON_BODY_LIMIT, verify: captureWebhookRawBody }));

  app.use('/api', apiRouter);
  app.use(sentryErrorHandler());
  app.use(errorHandler);

  return app;
};
