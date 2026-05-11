import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

const setProcessEnv = (nextEnv: NodeJS.ProcessEnv) => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }

  Object.assign(process.env, nextEnv);
};

const safeApiEnv = (overrides: NodeJS.ProcessEnv = {}) => ({
  ...originalEnv,
  APP_ENV: 'development',
  AUTH_SESSION_SECRET: 'unit-test-session-secret-with-more-than-thirty-two-chars',
  DOCUMENT_STORAGE_DRIVER: 'local',
  EMAIL_PROVIDER_MODE: 'disabled',
  FILE_SCAN_MODE: 'disabled',
  GOOGLE_AUTH_MODE: 'disabled',
  PAYMENT_PROVIDER_MODE: 'disabled',
  SMS_PROVIDER_MODE: 'disabled',
  ...overrides,
});

const invokeCorsDelegate = async (
  delegate: (
    origin: string | undefined,
    callback: (error: Error | null, origin?: boolean | string) => void
  ) => void,
  origin: string | undefined,
) =>
  new Promise<{ allowed?: boolean | string; error: Error | null }>((resolvePromise) => {
    delegate(origin, (error, allowed) => resolvePromise({ allowed, error }));
  });

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

afterEach(() => {
  setProcessEnv(originalEnv);
  vi.resetModules();
});

describe('network hardening helpers', () => {
  it('allows exact configured client CORS origins and rejects unlisted origins', async () => {
    vi.resetModules();
    setProcessEnv(
      safeApiEnv({
        PUBLIC_WEB_ORIGINS: 'https://app.globallmg.example,https://www.globallmg.example',
      }),
    );
    const appModule = await import('../../backend/src/app.js');
    const delegate = appModule.createCorsOriginDelegate([
      'https://app.globallmg.example',
      'https://www.globallmg.example',
    ]);

    await expect(invokeCorsDelegate(delegate, 'https://app.globallmg.example')).resolves.toMatchObject({
      allowed: 'https://app.globallmg.example',
      error: null,
    });
    await expect(invokeCorsDelegate(delegate, 'https://evil.example')).resolves.toMatchObject({
      allowed: false,
      error: null,
    });
    await expect(invokeCorsDelegate(delegate, undefined)).resolves.toMatchObject({
      allowed: true,
      error: null,
    });
  });

  it('keeps single-origin env compatibility for the client backend', async () => {
    vi.resetModules();
    const nextEnv = safeApiEnv({
      PUBLIC_WEB_ORIGIN: 'https://app.globallmg.example',
    });
    delete nextEnv.PUBLIC_WEB_ORIGINS;
    setProcessEnv(nextEnv);

    const { env } = await import('../../backend/src/config/env.js');

    expect(env.PUBLIC_WEB_ORIGINS).toEqual(['https://app.globallmg.example']);
  });

  it('allows exact configured admin CORS origins and exposes Sentry trace headers', async () => {
    vi.resetModules();
    setProcessEnv(
      safeApiEnv({
        PUBLIC_ADMIN_WEB_ORIGINS: 'https://admin.globallmg.example,https://ops.globallmg.example',
      }),
    );
    const appModule = await import('../../admin_backend/src/app.js');
    const delegate = appModule.createCorsOriginDelegate([
      'https://admin.globallmg.example',
      'https://ops.globallmg.example',
    ]);

    await expect(invokeCorsDelegate(delegate, 'https://ops.globallmg.example')).resolves.toMatchObject({
      allowed: 'https://ops.globallmg.example',
      error: null,
    });
    await expect(invokeCorsDelegate(delegate, 'https://evil.example')).resolves.toMatchObject({
      allowed: false,
      error: null,
    });
    expect(appModule.CORS_ALLOWED_HEADERS).toEqual(
      expect.arrayContaining(['content-type', 'x-csrf-token', 'idempotency-key', 'sentry-trace', 'baggage']),
    );
  });

  it('sends admin private ETags only after route authorization checks', () => {
    for (const routeFile of [
      'admin_backend/src/routes/dashboard.ts',
      'admin_backend/src/routes/billing.ts',
      'admin_backend/src/routes/messages.ts',
      'admin_backend/src/routes/reports.ts',
      'admin_backend/src/routes/requests.ts',
    ]) {
      const source = read(routeFile);
      const authorizationIndexes = [
        source.indexOf('await requireReadPermission'),
        source.indexOf('await requireAnyReadPermission'),
      ].filter((index) => index >= 0);
      const authorizationIndex = authorizationIndexes.length ? Math.min(...authorizationIndexes) : -1;
      expect(authorizationIndex).toBeGreaterThanOrEqual(0);
      expect(source.indexOf('sendPrivateJsonWithEtag', authorizationIndex)).toBeGreaterThan(authorizationIndex);
    }
  });

  it('returns 304 for matching private admin ETags', async () => {
    const { createPrivateEtag, sendPrivateJsonWithEtag } = await import(
      '../../admin_backend/src/lib/httpCache.js'
    );
    const actor = {
      displayName: 'Admin User',
      email: 'admin@example.test',
      id: 'usr_admin',
      mustRotatePassword: false,
      permissionCodes: ['dashboard.view'],
      roleCodes: ['ops_admin'],
      sessionId: 123,
      userId: 1,
    };
    const payload = { total: 1 };
    const etag = createPrivateEtag(actor, 'admin.dashboard', payload);
    const headers = new Map<string, string | number | readonly string[]>();
    const response = {
      end: vi.fn(),
      json: vi.fn(),
      setHeader: vi.fn((name: string, value: string | number | readonly string[]) => {
        headers.set(name, value);
      }),
      status: vi.fn().mockReturnThis(),
    };

    sendPrivateJsonWithEtag(
      { header: () => undefined } as never,
      response as never,
      { actor, payload, scope: 'admin.dashboard' },
    );

    expect(response.json).toHaveBeenCalledWith(payload);
    expect(headers.get('ETag')).toBe(etag);

    response.json.mockClear();
    sendPrivateJsonWithEtag(
      { header: (name: string) => (name.toLowerCase() === 'if-none-match' ? etag : undefined) } as never,
      response as never,
      { actor, payload, scope: 'admin.dashboard' },
    );

    expect(response.status).toHaveBeenCalledWith(304);
    expect(response.end).toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('sets no-store on webhook responses and caches readiness probes briefly', () => {
    expect(read('backend/src/routes/webhooks.ts')).toContain("response.setHeader('Cache-Control', 'no-store')");
    expect(read('admin_backend/src/routes/webhooks.ts')).toContain("response.setHeader('Cache-Control', 'no-store')");
    expect(read('backend/src/routes/health.ts')).toContain('HEALTH_READY_SUCCESS_CACHE_MS = 30_000');
    expect(read('backend/src/routes/health.ts')).toContain('HEALTH_READY_FAILURE_CACHE_MS = 5_000');
    expect(read('admin_backend/src/routes/health.ts')).toContain('HEALTH_READY_SUCCESS_CACHE_MS = 30_000');
    expect(read('admin_backend/src/routes/health.ts')).toContain('HEALTH_READY_FAILURE_CACHE_MS = 5_000');
  });
});
