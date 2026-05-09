import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { getDatabaseErrorDetails, isDatabaseOverloadedError } from './mysql.js';
import { getRequestId, logEvent } from './observability.js';

export class ApiError extends Error {
  public readonly code: string;
  public readonly issues?: unknown;
  public readonly retryAfterSeconds?: number;
  public readonly statusCode: number;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: {
      issues?: unknown;
      retryAfterSeconds?: number;
    } = {}
  ) {
    super(message);
    this.code = code;
    this.issues = options.issues;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.statusCode = statusCode;
  }
}

export const badRequest = (code: string, message: string, issues?: unknown) =>
  new ApiError(400, code, message, { issues });

export const unauthorized = (code: string, message: string) =>
  new ApiError(401, code, message);

export const forbidden = (code: string, message: string) =>
  new ApiError(403, code, message);

export const notFound = (code: string, message: string) =>
  new ApiError(404, code, message);

export const conflict = (code: string, message: string) =>
  new ApiError(409, code, message);

export const tooManyRequests = (code: string, message: string, retryAfterSeconds: number) =>
  new ApiError(429, code, message, { retryAfterSeconds });

export const internalServerError = (message = 'Unexpected server error.') =>
  new ApiError(500, 'internal_server_error', message);

export const serviceUnavailable = (code: string, message: string) =>
  new ApiError(503, code, message);

const SERVICE_UNAVAILABLE_MESSAGE =
  'Service is temporarily unavailable. Please try again shortly.';

export const asyncHandler =
  (
    handler: (request: Request, response: Response, next: NextFunction) => Promise<void> | void
  ) =>
  (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };

export const errorHandler = (
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction
) => {
  const requestId = getRequestId(response);

  if (error instanceof ZodError) {
    logEvent('warn', 'request.validation_failed', {
      issues: error.flatten(),
      method: request.method,
      path: request.originalUrl,
      requestId,
      statusCode: 400,
    });
    response.status(400).json({
      error: 'invalid_request_payload',
      message: 'Request payload validation failed.',
      issues: error.flatten(),
      requestId,
    });
    return;
  }

  if (
    error instanceof SyntaxError &&
    'status' in error &&
    Number((error as { status?: unknown }).status) === 400 &&
    'body' in error
  ) {
    logEvent('warn', 'request.invalid_json', {
      method: request.method,
      path: request.originalUrl,
      requestId,
      statusCode: 400,
    });
    response.status(400).json({
      error: 'invalid_json_body',
      message: 'Request body contains invalid JSON.',
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

  if (error instanceof ApiError) {
    logEvent(error.statusCode >= 500 ? 'error' : 'warn', 'request.api_error', {
      code: error.code,
      issues: error.issues,
      method: request.method,
      path: request.originalUrl,
      requestId,
      retryAfterSeconds: error.retryAfterSeconds,
      statusCode: error.statusCode,
    });

    if (error.retryAfterSeconds) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
    }

    response.status(error.statusCode).json({
      error: error.code,
      message: error.message,
      issues: error.issues,
      requestId,
      retryAfterSeconds: error.retryAfterSeconds,
    });
    return;
  }

  logEvent('error', 'request.unhandled_error', {
    error:
      error instanceof Error
        ? {
            message: error.message,
            name: error.name,
            stack: error.stack,
          }
        : error,
    method: request.method,
    path: request.originalUrl,
    requestId,
    statusCode: 500,
  });
  response.status(500).json({
    error: 'internal_server_error',
    message: 'Unexpected server error.',
    requestId,
  });
};
