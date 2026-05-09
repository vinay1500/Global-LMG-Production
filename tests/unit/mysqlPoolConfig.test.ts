import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const baseSettings = {
  MYSQL_CONNECT_TIMEOUT_MS: 5000,
  MYSQL_CONNECTION_LIMIT: 20,
  MYSQL_DATABASE: 'global_lmg',
  MYSQL_HOST: 'db.example.test',
  MYSQL_PASSWORD: 'not-printed',
  MYSQL_PORT: 3306,
  MYSQL_QUEUE_LIMIT: 100,
  MYSQL_SSL_CA: undefined,
  MYSQL_SSL_MODE: 'DISABLED' as const,
  MYSQL_USER: 'global_lmg',
  MYSQL_WAIT_FOR_CONNECTIONS: true,
};

let tempDir: string | null = null;
const originalAuthSessionSecret = process.env.AUTH_SESSION_SECRET;

let buildBackendMysqlPoolConfig: typeof import('../../backend/src/lib/mysql.js').buildMysqlPoolConfig;
let readBackendMysqlSslCa: typeof import('../../backend/src/lib/mysql.js').readMysqlSslCa;
let resolveBackendMysqlSslCaPath: typeof import('../../backend/src/lib/mysql.js').resolveMysqlSslCaPath;
let buildAdminMysqlPoolConfig: typeof import('../../admin_backend/src/lib/mysql.js').buildMysqlPoolConfig;
let readAdminMysqlSslCa: typeof import('../../admin_backend/src/lib/mysql.js').readMysqlSslCa;
let resolveAdminMysqlSslCaPath: typeof import('../../admin_backend/src/lib/mysql.js').resolveMysqlSslCaPath;

beforeAll(async () => {
  process.env.AUTH_SESSION_SECRET = 'mysql-pool-config-unit-secret-1234567890';

  const backendMysql = await import('../../backend/src/lib/mysql.js');
  const adminMysql = await import('../../admin_backend/src/lib/mysql.js');

  buildBackendMysqlPoolConfig = backendMysql.buildMysqlPoolConfig;
  readBackendMysqlSslCa = backendMysql.readMysqlSslCa;
  resolveBackendMysqlSslCaPath = backendMysql.resolveMysqlSslCaPath;
  buildAdminMysqlPoolConfig = adminMysql.buildMysqlPoolConfig;
  readAdminMysqlSslCa = adminMysql.readMysqlSslCa;
  resolveAdminMysqlSslCaPath = adminMysql.resolveMysqlSslCaPath;
});

afterAll(() => {
  if (originalAuthSessionSecret === undefined) {
    delete process.env.AUTH_SESSION_SECRET;
    return;
  }

  process.env.AUTH_SESSION_SECRET = originalAuthSessionSecret;
});

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { force: true, recursive: true });
    tempDir = null;
  }
});

describe('MySQL pool configuration', () => {
  it('keeps backend and admin backend date, charset, and decimal behavior aligned', () => {
    const backendConfig = buildBackendMysqlPoolConfig(baseSettings);
    const adminConfig = buildAdminMysqlPoolConfig(baseSettings);

    for (const config of [backendConfig, adminConfig]) {
      expect(config.dateStrings).toBe(true);
      expect(config.timezone).toBe('Z');
      expect(config.charset).toBe('utf8mb4');
      expect(config.decimalNumbers).toBe(true);
      expect(config.waitForConnections).toBe(true);
      expect(config.connectionLimit).toBe(20);
      expect(config.queueLimit).toBe(100);
    }
  });

  it('keeps absolute CA paths absolute', () => {
    const absolutePath = path.join(path.sep, 'etc', 'global-lmg', 'certs', 'aiven-ca.pem');

    expect(resolveBackendMysqlSslCaPath(absolutePath, '/srv/global-lmg/current/backend')).toBe(absolutePath);
    expect(resolveAdminMysqlSslCaPath(absolutePath, '/srv/global-lmg/current/admin_backend')).toBe(absolutePath);
  });

  it('resolves relative CA paths from the package root rather than process cwd', () => {
    expect(resolveBackendMysqlSslCaPath('../certs/aiven/ca.pem', '/srv/global-lmg/current/backend')).toBe(
      path.resolve('/srv/global-lmg/current/backend', '../certs/aiven/ca.pem')
    );
    expect(resolveAdminMysqlSslCaPath('../certs/aiven/ca.pem', '/srv/global-lmg/current/admin_backend')).toBe(
      path.resolve('/srv/global-lmg/current/admin_backend', '../certs/aiven/ca.pem')
    );
  });

  it('reads configured CA files and fails clearly when a configured CA file is missing', () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'glmg-mysql-ca-'));
    const caPath = path.join(tempDir, 'aiven-ca.pem');
    writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n');

    expect(readBackendMysqlSslCa(caPath)).toContain('BEGIN CERTIFICATE');
    expect(readAdminMysqlSslCa(caPath)).toContain('BEGIN CERTIFICATE');
    expect(() => readBackendMysqlSslCa('missing-ca.pem', tempDir!)).toThrow(
      /Configured MySQL SSL CA file was not found/
    );
    expect(() => readAdminMysqlSslCa('missing-ca.pem', tempDir!)).toThrow(
      /Configured MySQL SSL CA file was not found/
    );
  });
});
