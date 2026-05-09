import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { getRequestIpAddress } from './requestSecurity.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export type RequestContext = {
  ipAddress: string | null;
  requestId: string;
  userAgent: string | null;
};

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

const shouldLog = (level: LogLevel) =>
  LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[env.LOG_LEVEL];

const writeStructuredLog = (level: LogLevel, payload: Record<string, unknown>) => {
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(payload)}\n`);
};

const getUserAgent = (request: Request) => request.header('user-agent')?.trim() || null;

const resolveRequestId = (request: Request) => {
  const incomingId = request.header(REQUEST_ID_HEADER);

  if (incomingId && REQUEST_ID_PATTERN.test(incomingId)) {
    return incomingId;
  }

  return randomUUID();
};

export const getRequestId = (response: Response) =>
  typeof response.locals.requestId === 'string' ? response.locals.requestId : 'unknown';

export const getRequestContext = () => requestContextStorage.getStore() || null;

export const logEvent = (
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {}
) => {
  if (!shouldLog(level)) {
    return;
  }

  writeStructuredLog(level, {
    environment: env.APP_ENV,
    level,
    message,
    service: 'global-lmg-admin-api',
    timestamp: new Date().toISOString(),
    ...fields,
  });
};

export const requestContextMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction
) => {
  const requestId = resolveRequestId(request);
  const ipAddress = getRequestIpAddress(request) || null;
  const userAgent = getUserAgent(request);

  response.locals.requestId = requestId;
  response.locals.ipAddress = ipAddress;
  response.locals.requestStartedAt = process.hrtime.bigint();
  response.locals.userAgent = userAgent;
  response.setHeader(REQUEST_ID_HEADER, requestId);

  requestContextStorage.run(
    {
      ipAddress,
      requestId,
      userAgent,
    },
    next
  );
};

export const requestLoggingMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction
) => {
  if (!env.REQUEST_LOGGING_ENABLED) {
    next();
    return;
  }

  response.on('finish', () => {
    const startedAt = response.locals.requestStartedAt as bigint | undefined;
    const durationMs = startedAt
      ? Number(process.hrtime.bigint() - startedAt) / 1_000_000
      : undefined;
    const statusCode = response.statusCode;
    const level: LogLevel =
      statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    logEvent(level, 'request.completed', {
      contentLength: Number(response.getHeader('content-length') || 0),
      durationMs: durationMs ? Number(durationMs.toFixed(2)) : undefined,
      ip: getRequestIpAddress(request),
      method: request.method,
      path: request.originalUrl,
      requestId: getRequestId(response),
      statusCode,
      userAgent: request.header('user-agent') || 'unknown',
    });
  });

  next();
};
