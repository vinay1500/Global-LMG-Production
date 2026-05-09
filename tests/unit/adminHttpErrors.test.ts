import type { Request, Response } from 'express';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { env as AdminEnv } from '../../admin_backend/src/config/env.js';
import type { AppError as AdminAppError } from '../../admin_backend/src/lib/httpErrors.js';

type MockResponse = Response & {
  headers: Record<string, string>;
  payload?: Record<string, unknown>;
  statusCodeValue: number;
};

let AppError: typeof AdminAppError;
let env: typeof AdminEnv;
let errorMiddleware: typeof import('../../admin_backend/src/lib/httpErrors.js').errorMiddleware;
let originalAppEnv: typeof AdminEnv.APP_ENV;

beforeAll(async () => {
  process.env.AUTH_SESSION_SECRET ||= 'unit-test-admin-session-secret-1234567890';
  ({ env } = await import('../../admin_backend/src/config/env.js'));
  ({ AppError, errorMiddleware } = await import('../../admin_backend/src/lib/httpErrors.js'));
  originalAppEnv = env.APP_ENV;
});

const createRequest = () =>
  ({
    method: 'GET',
    originalUrl: '/api/v1/admin/test',
  }) as Request;

const createResponse = () => {
  const response = {
    headers: {} as Record<string, string>,
    locals: {
      requestId: 'req_test_12345678',
    },
    statusCodeValue: 200,
    json: vi.fn((payload: Record<string, unknown>) => {
      response.payload = payload;
      return response;
    }),
    setHeader: vi.fn((name: string, value: string) => {
      response.headers[name] = value;
      return response;
    }),
    status: vi.fn((statusCode: number) => {
      response.statusCodeValue = statusCode;
      return response;
    }),
  };

  return response as unknown as MockResponse;
};

const silenceStructuredLogs = () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
};

afterEach(() => {
  env.APP_ENV = originalAppEnv;
  vi.restoreAllMocks();
});

describe('admin errorMiddleware', () => {
  it('hides raw unhandled errors in production 500 responses', () => {
    env.APP_ENV = 'production';
    silenceStructuredLogs();
    const response = createResponse();

    errorMiddleware(
      new Error('ER_ACCESS_DENIED_ERROR: SQL password rejected'),
      createRequest(),
      response,
      vi.fn()
    );

    expect(response.statusCodeValue).toBe(500);
    expect(response.payload).toEqual({
      error: 'internal_server_error',
      errorName: undefined,
      message: 'Unexpected server error. Reference the request ID when contacting support.',
      requestId: 'req_test_12345678',
      stack: undefined,
    });
  });

  it('keeps useful unhandled error details in development', () => {
    env.APP_ENV = 'development';
    silenceStructuredLogs();
    const response = createResponse();
    const error = new TypeError('Provider client failed loudly.');

    errorMiddleware(error, createRequest(), response, vi.fn());

    expect(response.statusCodeValue).toBe(500);
    expect(response.payload).toMatchObject({
      error: 'internal_server_error',
      errorName: 'TypeError',
      message: 'Provider client failed loudly.',
      requestId: 'req_test_12345678',
    });
    expect(String(response.payload?.stack || '')).toContain('TypeError');
  });

  it('preserves known safe application error messages in production', () => {
    env.APP_ENV = 'production';
    silenceStructuredLogs();
    const response = createResponse();

    errorMiddleware(
      new AppError(400, 'invalid_request_payload', 'Request payload validation failed.', {
        fieldErrors: { email: ['Invalid email.'] },
      }),
      createRequest(),
      response,
      vi.fn()
    );

    expect(response.statusCodeValue).toBe(400);
    expect(response.payload).toEqual({
      error: 'invalid_request_payload',
      issues: {
        fieldErrors: { email: ['Invalid email.'] },
      },
      message: 'Request payload validation failed.',
      requestId: 'req_test_12345678',
    });
  });

  it('hides application 500 messages in production while preserving status and code', () => {
    env.APP_ENV = 'production';
    silenceStructuredLogs();
    const response = createResponse();

    errorMiddleware(
      new AppError(500, 'invoice_pdf_failed', 'PDF renderer leaked /tmp/internal.pdf'),
      createRequest(),
      response,
      vi.fn()
    );

    expect(response.statusCodeValue).toBe(500);
    expect(response.payload).toEqual({
      error: 'invoice_pdf_failed',
      issues: undefined,
      message: 'Unexpected server error. Reference the request ID when contacting support.',
      requestId: 'req_test_12345678',
    });
  });
});
