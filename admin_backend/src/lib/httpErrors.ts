import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { getDatabaseErrorDetails, isDatabaseOverloadedError } from './mysql.js';
import { getRequestId, logEvent } from './observability.js';

export class AppError extends Error {
  public readonly code: string;
  public readonly issues?: unknown;
  public readonly statusCode: number;

  constructor(statusCode: number, code: string, message: string, issues?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.issues = issues;
  }
}

export const badRequest = (code: string, message: string, issues?: unknown) =>
  new AppError(400, code, message, issues);

export const unauthorized = (code: string, message: string) =>
  new AppError(401, code, message);

export const forbidden = (code: string, message: string) => new AppError(403, code, message);

export const tooManyRequests = (code: string, message: string, issues?: unknown) =>
  new AppError(429, code, message, issues);

export const notFound = (code: string, message: string) => new AppError(404, code, message);

export const asyncHandler =
  (
    handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown> | unknown
  ) =>
  (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };

const GENERIC_INTERNAL_ERROR_MESSAGE =
  'Unexpected server error. Reference the request ID when contacting support.';
const SERVICE_UNAVAILABLE_MESSAGE =
  'Service is temporarily unavailable. Please try again shortly.';

const shouldExposeErrorDetails = () => env.APP_ENV !== 'production';

export const errorMiddleware = (
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction
) => {
  const requestId = getRequestId(response);

  if (error instanceof AppError) {
    logEvent(error.statusCode >= 500 ? 'error' : 'warn', 'request.error', {
      errorCode: error.code,
      issues: error.issues,
      method: request.method,
      path: request.originalUrl,
      requestId,
      statusCode: error.statusCode,
    });

    const exposeErrorDetails = error.statusCode < 500 || shouldExposeErrorDetails();

    response.status(error.statusCode).json({
      error: error.code,
      issues: exposeErrorDetails ? error.issues : undefined,
      message: exposeErrorDetails ? error.message : GENERIC_INTERNAL_ERROR_MESSAGE,
      requestId,
    });
    return;
  }

  if (isDatabaseOverloadedError(error)) {
    const databaseError = getDatabaseErrorDetails(error);
    logEvent('error', 'request.database_unavailable', {
      databaseError,
      method: request.method,
      path: request.originalUrl,
      requestId,
      statusCode: 503,
    });

    response.status(503).json({
      code: 'service_unavailable',
      error: 'service_unavailable',
      message: SERVICE_UNAVAILABLE_MESSAGE,
      requestId,
    });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const exposeErrorDetails = shouldExposeErrorDetails();
  logEvent('error', 'request.error', {
    errorMessage: message,
    errorName,
    errorStack: env.APP_ENV === 'production' ? undefined : error instanceof Error ? error.stack : undefined,
    method: request.method,
    path: request.originalUrl,
    requestId,
    statusCode: 500,
  });

  response.status(500).json({
    error: 'internal_server_error',
    errorName: exposeErrorDetails ? errorName : undefined,
    message: exposeErrorDetails ? message : GENERIC_INTERNAL_ERROR_MESSAGE,
    requestId,
    stack: exposeErrorDetails && error instanceof Error ? error.stack : undefined,
  });
};
