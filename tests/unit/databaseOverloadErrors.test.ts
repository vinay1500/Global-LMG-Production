import type { Request, Response } from 'express';
import { beforeAll, describe, expect, it, vi } from 'vitest';

type MockResponse = Response & {
  payload?: Record<string, unknown>;
  statusCodeValue: number;
};

let backendErrorHandler: typeof import('../../backend/src/lib/httpErrors.js').errorHandler;
let backendGetDatabaseErrorDetails: typeof import('../../backend/src/lib/mysql.js').getDatabaseErrorDetails;
let backendIsDatabaseOverloadedError: typeof import('../../backend/src/lib/mysql.js').isDatabaseOverloadedError;
let adminErrorMiddleware: typeof import('../../admin_backend/src/lib/httpErrors.js').errorMiddleware;
let adminGetDatabaseErrorDetails: typeof import('../../admin_backend/src/lib/mysql.js').getDatabaseErrorDetails;
let adminIsDatabaseOverloadedError: typeof import('../../admin_backend/src/lib/mysql.js').isDatabaseOverloadedError;

beforeAll(async () => {
  process.env.AUTH_SESSION_SECRET ||= 'database-overload-unit-secret-1234567890';

  const backendMysql = await import('../../backend/src/lib/mysql.js');
  const adminMysql = await import('../../admin_backend/src/lib/mysql.js');
  const backendHttpErrors = await import('../../backend/src/lib/httpErrors.js');
  const adminHttpErrors = await import('../../admin_backend/src/lib/httpErrors.js');

  backendIsDatabaseOverloadedError = backendMysql.isDatabaseOverloadedError;
  backendGetDatabaseErrorDetails = backendMysql.getDatabaseErrorDetails;
  adminIsDatabaseOverloadedError = adminMysql.isDatabaseOverloadedError;
  adminGetDatabaseErrorDetails = adminMysql.getDatabaseErrorDetails;
  backendErrorHandler = backendHttpErrors.errorHandler;
  adminErrorMiddleware = adminHttpErrors.errorMiddleware;
});

const createRequest = () =>
  ({
    method: 'GET',
    originalUrl: '/api/v1/test',
  }) as Request;

const createResponse = () => {
  const response = {
    locals: {
      requestId: 'req_database_overload',
    },
    payload: undefined as Record<string, unknown> | undefined,
    statusCodeValue: 200,
    json: vi.fn((payload: Record<string, unknown>) => {
      response.payload = payload;
      return response;
    }),
    setHeader: vi.fn(() => response),
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
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
};

const makeError = (message: string, code?: string, errno?: number) => {
  const error = new Error(message) as Error & { code?: string; errno?: number };
  error.code = code;
  error.errno = errno;
  return error;
};

describe('database overload error classification', () => {
  it('classifies pool queue exhaustion, timeouts, and too many connections', () => {
    const errors = [
      makeError('Queue limit reached.'),
      makeError('connect ETIMEDOUT 10.0.0.1:3306', 'ETIMEDOUT'),
      makeError('Too many connections', 'ER_CON_COUNT_ERROR', 1040),
      makeError('Connection lost: The server closed the connection.', 'PROTOCOL_CONNECTION_LOST'),
    ];

    for (const error of errors) {
      expect(backendIsDatabaseOverloadedError(error)).toBe(true);
      expect(adminIsDatabaseOverloadedError(error)).toBe(true);
    }
  });

  it('checks wrapped startup/runtime causes without treating validation errors as overload', () => {
    const wrapped = new Error('Repository call failed', {
      cause: makeError('Queue limit reached.'),
    });

    expect(backendIsDatabaseOverloadedError(wrapped)).toBe(true);
    expect(adminIsDatabaseOverloadedError(wrapped)).toBe(true);
    expect(backendGetDatabaseErrorDetails(wrapped)?.message).toBe('Queue limit reached.');
    expect(adminGetDatabaseErrorDetails(wrapped)?.message).toBe('Queue limit reached.');
    expect(backendIsDatabaseOverloadedError(new Error('Invalid request payload.'))).toBe(false);
    expect(adminIsDatabaseOverloadedError(new Error('Invalid request payload.'))).toBe(false);
  });
});

describe('database overload HTTP responses', () => {
  it('returns a safe 503 response from the client backend error handler', () => {
    silenceStructuredLogs();
    const response = createResponse();

    backendErrorHandler(makeError('Queue limit reached.'), createRequest(), response, vi.fn());

    expect(response.statusCodeValue).toBe(503);
    expect(response.payload).toEqual({
      code: 'service_unavailable',
      error: 'service_unavailable',
      message: 'Service is temporarily unavailable. Please try again shortly.',
      requestId: 'req_database_overload',
    });
  });

  it('returns a safe 503 response from the admin backend error handler', () => {
    silenceStructuredLogs();
    const response = createResponse();

    adminErrorMiddleware(
      makeError('Too many connections', 'ER_CON_COUNT_ERROR', 1040),
      createRequest(),
      response,
      vi.fn()
    );

    expect(response.statusCodeValue).toBe(503);
    expect(response.payload).toEqual({
      code: 'service_unavailable',
      error: 'service_unavailable',
      message: 'Service is temporarily unavailable. Please try again shortly.',
      requestId: 'req_database_overload',
    });
  });
});
