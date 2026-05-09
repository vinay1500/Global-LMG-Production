import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorMiddleware } from './lib/httpErrors.js';
import { requestContextMiddleware, requestLoggingMiddleware } from './lib/observability.js';
import { initSentry, sentryErrorHandler } from './lib/sentry.js';
import { apiRouter } from './routes/index.js';
import { webhookRouter } from './routes/webhooks.js';

export const createApp = () => {
  initSentry();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
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
      credentials: true,
      exposedHeaders: ['content-disposition'],
      origin: env.PUBLIC_ADMIN_WEB_ORIGIN,
    })
  );
  app.use('/api/v1/webhooks', webhookRouter);
  app.use(express.json({ limit: env.ADMIN_JSON_BODY_LIMIT }));
  app.use('/api', apiRouter);
  app.use(sentryErrorHandler());
  app.use(errorMiddleware);

  return app;
};
