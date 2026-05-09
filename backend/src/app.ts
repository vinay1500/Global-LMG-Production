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

export const createApp = () => {
  initSentry();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
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
      credentials: true,
      origin: env.PUBLIC_WEB_ORIGIN,
    })
  );
  app.use(express.json({ limit: env.API_JSON_BODY_LIMIT, verify: captureWebhookRawBody }));

  app.use('/api', apiRouter);
  app.use(sentryErrorHandler());
  app.use(errorHandler);

  return app;
};
