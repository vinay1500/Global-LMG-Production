import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const strongSecret = 'unit-auth-session-secret-0123456789abcdef-strong';
const originalProcessEnv = { ...process.env };

const makeRequest = (cookie: string, headerToken?: string) =>
  ({
    header: (name: string) => {
      const normalized = name.toLowerCase();
      if (normalized === 'x-csrf-token') {
        return headerToken;
      }
      if (normalized === 'x-forwarded-for') {
        return '198.51.100.10, 203.0.113.20';
      }
      if (normalized === 'user-agent') {
        return 'vitest';
      }
      return undefined;
    },
    headers: { cookie },
    ip: '203.0.113.1',
    socket: { remoteAddress: '203.0.113.2' },
  }) as never;

const loadClientCsrf = async () => {
  vi.resetModules();
  process.env.AUTH_SESSION_SECRET = strongSecret;
  const [{ createSignedCsrfToken }, { requireCsrf }] = await Promise.all([
    import('../../backend/src/lib/authCrypto.js'),
    import('../../backend/src/lib/csrf.js'),
  ]);
  return { createSignedCsrfToken, requireCsrf };
};

const loadAdminCsrf = async () => {
  vi.resetModules();
  process.env.AUTH_SESSION_SECRET = strongSecret;
  process.env.APP_ENV = 'development';
  const [{ createSignedCsrfToken }, { requireCsrf }] = await Promise.all([
    import('../../admin_backend/src/lib/authCrypto.js'),
    import('../../admin_backend/src/lib/csrf.js'),
  ]);
  return { createSignedCsrfToken, requireCsrf };
};

const writeEnv = (dir: string, name: string, values: Record<string, string>) => {
  const filePath = path.join(dir, name);
  writeFileSync(
    filePath,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')
  );
  return filePath;
};

const baseApiEnv = (originKey: 'PUBLIC_ADMIN_WEB_ORIGIN' | 'PUBLIC_WEB_ORIGIN') => ({
  APP_ENV: 'production',
  AUTH_SESSION_SECRET: strongSecret,
  CSRF_COOKIE_NAME: `${originKey.toLowerCase()}_csrf`,
  EMAIL_PROVIDER_MODE: 'disabled',
  FILE_SCAN_MODE: 'disabled',
  MYSQL_DATABASE: 'defaultdb',
  MYSQL_HOST: 'db.example.com',
  MYSQL_PASSWORD: 'not-printed',
  MYSQL_SSL_CA_PATH: '/tmp/ca.pem',
  MYSQL_SSL_MODE: 'REQUIRED',
  MYSQL_USER: 'global_lmg',
  OBJECT_STORAGE_DRIVER: 'local',
  PAYMENT_PROVIDER_MODE: 'disabled',
  SESSION_COOKIE_NAME: `${originKey.toLowerCase()}_session`,
  SMS_PROVIDER_MODE: 'disabled',
  [originKey]: originKey === 'PUBLIC_ADMIN_WEB_ORIGIN'
    ? 'https://admin.globallmg.example'
    : 'https://www.globallmg.example',
});

const runValidator = (paths: {
  admin: string;
  adminFrontend: string;
  backend: string;
  frontend: string;
}) => {
  try {
    return execFileSync(
      process.execPath,
      [
        'scripts/validate-production-env.mjs',
        '--backend-env',
        paths.backend,
        '--admin-env',
        paths.admin,
        '--frontend-env',
        paths.frontend,
        '--admin-frontend-env',
        paths.adminFrontend,
      ],
      { cwd: repoRoot, encoding: 'utf8' }
    );
  } catch (error) {
    return String((error as { stdout?: string }).stdout || '');
  }
};

describe('signed double-submit CSRF helpers', () => {
  it('rejects client mutations without a matching CSRF header', async () => {
    const { createSignedCsrfToken, requireCsrf } = await loadClientCsrf();
    const token = createSignedCsrfToken(strongSecret);

    expect(() =>
      requireCsrf(makeRequest(`global_lmg_csrf=${encodeURIComponent(token)}`))
    ).toThrow(/CSRF validation failed/);
  });

  it('accepts matching signed CSRF cookies and headers for client and admin backends', async () => {
    const client = await loadClientCsrf();
    const clientToken = client.createSignedCsrfToken(strongSecret);
    expect(() =>
      client.requireCsrf(
        makeRequest(`global_lmg_csrf=${encodeURIComponent(clientToken)}`, clientToken)
      )
    ).not.toThrow();

    const admin = await loadAdminCsrf();
    const adminToken = admin.createSignedCsrfToken(strongSecret);
    expect(() =>
      admin.requireCsrf(
        makeRequest(`global_lmg_admin_csrf=${encodeURIComponent(adminToken)}`, adminToken)
      )
    ).not.toThrow();
  });

  it('rejects tampered or malformed signed CSRF token signatures safely', async () => {
    const { createSignedCsrfToken, requireCsrf } = await loadClientCsrf();
    const token = createSignedCsrfToken(strongSecret);
    const [nonce] = token.split('.');
    const malformedTokens = [
      `${nonce}.not-a-valid-signature`,
      `${nonce}.zzzz`,
      `${nonce}.${Buffer.from('not-hex').toString('base64url')}`,
      `${nonce}.`,
    ];

    for (const malformedToken of malformedTokens) {
      expect(() =>
        requireCsrf(
          makeRequest(`global_lmg_csrf=${encodeURIComponent(malformedToken)}`, malformedToken)
        )
      ).toThrow(/CSRF validation failed/);
    }

    const tamperedToken = token.replace(/[a-f0-9]$/i, (value) => (value === 'a' ? 'b' : 'a'));
    expect(() =>
      requireCsrf(
        makeRequest(`global_lmg_csrf=${encodeURIComponent(tamperedToken)}`, tamperedToken)
      )
    ).toThrow(/CSRF validation failed/);
  });
});

describe('security helper hardening', () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalProcessEnv);
    vi.restoreAllMocks();
  });

  it('uses Express req.ip instead of manually trusting x-forwarded-for', async () => {
    vi.resetModules();
    const [client, admin] = await Promise.all([
      import('../../backend/src/lib/requestSecurity.js'),
      import('../../admin_backend/src/lib/requestSecurity.js'),
    ]);
    const request = makeRequest('', 'unused');

    expect(client.getRequestIpAddress(request)).toBe('203.0.113.1');
    expect(admin.getRequestIpAddress(request)).toBe('203.0.113.1');
  });

  it('logs security-event persistence failures without throwing', async () => {
    vi.resetModules();
    process.env.AUTH_SESSION_SECRET = strongSecret;
    process.env.LOG_LEVEL = 'debug';
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { recordSecurityEventSafely } = await import('../../backend/src/lib/securityEvents.js');

    expect(() =>
      recordSecurityEventSafely(
        {
          eventTypeCode: 'unit.security_failure',
          ipAddress: '203.0.113.1',
          success: false,
          userAgent: 'vitest',
        },
        {
          execute: async () => {
            throw Object.assign(new Error('database unavailable'), { code: 'ER_UNIT_TEST' });
          },
        } as never
      )
    ).not.toThrow();

    await new Promise((resolve) => setImmediate(resolve));

    expect(warningSpy).toHaveBeenCalledTimes(1);
    expect(warningSpy.mock.calls[0]?.[0]).toContain('security_event.record_failed');
    expect(warningSpy.mock.calls[0]?.[0]).toContain('unit.security_failure');
  });

  it('rejects placeholder-like backend AUTH_SESSION_SECRET values in production config', async () => {
    vi.resetModules();
    process.env.APP_ENV = 'production';
    process.env.AUTH_SESSION_SECRET = 'placeholder-placeholder-placeholder-123456';
    process.env.PUBLIC_WEB_ORIGIN = 'https://www.globallmg.example';
    process.env.EMAIL_PROVIDER_MODE = 'disabled';
    process.env.SMS_PROVIDER_MODE = 'disabled';
    process.env.GOOGLE_AUTH_MODE = 'disabled';
    process.env.PAYMENT_PROVIDER_MODE = 'disabled';

    await expect(import('../../backend/src/config/env.js')).rejects.toThrow(
      'Production AUTH_SESSION_SECRET must be a strong non-placeholder secret.'
    );
  });
});

describe('production env validator auth/session checks', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { force: true, recursive: true });
      tempDir = null;
    }
  });

  const makeEnvFiles = (adminOverrides: Record<string, string>) => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'glmg-env-validator-'));
    const backend = writeEnv(tempDir, 'backend.env', {
      ...baseApiEnv('PUBLIC_WEB_ORIGIN'),
      GOOGLE_AUTH_MODE: 'disabled',
    });
    const admin = writeEnv(tempDir, 'admin.env', {
      ...baseApiEnv('PUBLIC_ADMIN_WEB_ORIGIN'),
      ...adminOverrides,
    });
    const frontend = writeEnv(tempDir, 'frontend.env', {
      VITE_API_BASE_URL: 'https://api.globallmg.example/api/v1',
    });
    const adminFrontend = writeEnv(tempDir, 'admin_frontend.env', {
      VITE_API_BASE_URL: 'https://admin-api.globallmg.example/api/v1/admin',
    });

    return { admin, adminFrontend, backend, frontend };
  };

  it('rejects a production admin origin that is not HTTPS', () => {
    const output = runValidator(
      makeEnvFiles({ PUBLIC_ADMIN_WEB_ORIGIN: 'http://admin.globallmg.example' })
    );

    expect(output).toContain('FAIL [admin_backend] PUBLIC_ADMIN_WEB_ORIGIN');
  });

  it('rejects placeholder-like admin AUTH_SESSION_SECRET values', () => {
    const output = runValidator(
      makeEnvFiles({ AUTH_SESSION_SECRET: 'replace-me-replace-me-replace-me-replace-me' })
    );

    expect(output).toContain('FAIL [admin_backend] AUTH_SESSION_SECRET');
  });
});

describe('session cap pruning', () => {
  it('client saveSession revokes expired sessions and prunes older active sessions', async () => {
    vi.resetModules();
    process.env.AUTH_SESSION_SECRET = strongSecret;
    process.env.MAX_ACTIVE_SESSIONS_PER_USER = '10';
    const { MysqlAuthStore } = await import('../../backend/src/modules/auth/mysqlAuthStore.js');
    const executed: Array<{ sql: string; values: unknown[] }> = [];
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      execute: async (sql: string, values: unknown[] = []) => {
        executed.push({ sql, values });
        return [{ affectedRows: 1, insertId: 1 }, []];
      },
      query: async (sql: string) => {
        if (sql.includes('FROM users WHERE public_id')) {
          return [[{ id: 42 }], []];
        }

        return [[], []];
      },
      release: () => undefined,
      rollback: async () => undefined,
    };
    const pool = {
      getConnection: async () => connection,
    };
    class TestMysqlAuthStore extends MysqlAuthStore {
      public override async initialize() {
        return undefined;
      }
    }
    const store = new TestMysqlAuthStore(pool as never);

    await store.saveSession({
      accountId: 'user_public_id',
      createdAt: '2026-05-09T00:00:00.000Z',
      expiresAt: '2026-05-09T12:00:00.000Z',
      hashedToken: 'hashed-session-token',
      lastSeenAt: '2026-05-09T00:00:00.000Z',
      rememberMe: false,
    });

    expect(executed.some((entry) => entry.sql.includes('expires_at <= UTC_TIMESTAMP'))).toBe(true);
    const pruneUpdate = executed.find((entry) => entry.sql.includes('keep_sessions'));
    expect(pruneUpdate?.sql).toContain('ORDER BY created_at DESC, id DESC');
    expect(pruneUpdate?.sql).toContain('LIMIT 10');
    expect(pruneUpdate?.values).not.toContain(10);
  });

  it('admin session pruning uses the configured active-session cap', async () => {
    vi.resetModules();
    process.env.APP_ENV = 'development';
    process.env.AUTH_SESSION_SECRET = strongSecret;
    process.env.MAX_ACTIVE_SESSIONS_PER_USER = '10';
    const { pruneActiveSessionsForUser } = await import(
      '../../admin_backend/src/modules/auth/service.js'
    );
    const executed: Array<{ sql: string; values: unknown[] }> = [];
    const executor = {
      execute: async (sql: string, values: unknown[] = []) => {
        executed.push({ sql, values });
        return [{ affectedRows: 1 }, []];
      },
      query: async () => [[], []],
    };

    await pruneActiveSessionsForUser(42, executor as never);

    expect(executed.some((entry) => entry.sql.includes('expires_at <= UTC_TIMESTAMP'))).toBe(true);
    const pruneUpdate = executed.find((entry) => entry.sql.includes('keep_sessions'));
    expect(pruneUpdate?.sql).toContain('ORDER BY created_at DESC, id DESC');
    expect(pruneUpdate?.sql).toContain('LIMIT 10');
    expect(pruneUpdate?.values).not.toContain(10);
  });
});
