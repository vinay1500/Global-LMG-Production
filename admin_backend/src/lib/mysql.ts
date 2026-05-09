import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';
import { env } from '../config/env.js';

let pool: Pool | null = null;

export type QueryExecutor = Pick<Pool | PoolConnection, 'execute' | 'query'>;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type MysqlPoolSettings = {
  MYSQL_CONNECT_TIMEOUT_MS: number;
  MYSQL_CONNECTION_LIMIT: number;
  MYSQL_DATABASE?: string;
  MYSQL_HOST?: string;
  MYSQL_PASSWORD?: string;
  MYSQL_PORT: number;
  MYSQL_QUEUE_LIMIT: number;
  MYSQL_SSL_CA?: string;
  MYSQL_SSL_MODE: 'DISABLED' | 'REQUIRED';
  MYSQL_USER?: string;
  MYSQL_WAIT_FOR_CONNECTIONS: boolean;
};

export const MYSQL_POOL_CHARSET = 'utf8mb4';
export const MYSQL_POOL_DECIMAL_NUMBERS = true;
export const MYSQL_POOL_TIMEZONE = 'Z';

type DatabaseOverloadCandidate = {
  cause?: unknown;
  code?: unknown;
  errno?: unknown;
  message?: unknown;
  name?: unknown;
  originalError?: unknown;
};

const DATABASE_OVERLOAD_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'ER_CON_COUNT_ERROR',
  'ER_USER_LIMIT_REACHED',
  'POOL_ENQUEUELIMIT',
  'PROTOCOL_CONNECTION_LOST',
]);

const DATABASE_OVERLOAD_ERRNOS = new Set([1040, 1226]);

type DatabaseErrorDetails = {
  code?: string;
  errno?: number;
  message?: string;
  name?: string;
};

const getCurrentDatabaseErrorDetails = (error: unknown): DatabaseErrorDetails | null => {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as DatabaseOverloadCandidate;
  return {
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    errno: typeof candidate.errno === 'number' ? candidate.errno : undefined,
    message:
      error instanceof Error
        ? error.message
        : typeof candidate.message === 'string'
          ? candidate.message
          : undefined,
    name: error instanceof Error ? error.name : typeof candidate.name === 'string' ? candidate.name : undefined,
  };
};

const isDatabaseOverloadDetails = (details: DatabaseErrorDetails) => {
  if (details.code && DATABASE_OVERLOAD_ERROR_CODES.has(details.code)) {
    return true;
  }

  if (details.errno !== undefined && DATABASE_OVERLOAD_ERRNOS.has(details.errno)) {
    return true;
  }

  const message = details.message?.toLowerCase() || '';
  return (
    message.includes('queue limit reached') ||
    message.includes('too many connections') ||
    message.includes('pool is full') ||
    message.includes('connect etimedout') ||
    message.includes('connect timeout') ||
    message.includes('connection lost')
  );
};

export const getDatabaseErrorDetails = (error: unknown): DatabaseErrorDetails | null => {
  const details = getCurrentDatabaseErrorDetails(error);

  if (details && isDatabaseOverloadDetails(details)) {
    return details;
  }

  if (!error || typeof error !== 'object') {
    return details;
  }

  const candidate = error as DatabaseOverloadCandidate;
  return (
    getDatabaseErrorDetails(candidate.cause) ||
    getDatabaseErrorDetails(candidate.originalError) ||
    details
  );
};

const isCurrentDatabaseOverloadError = (error: unknown) => {
  const details = getCurrentDatabaseErrorDetails(error);

  return details ? isDatabaseOverloadDetails(details) : false;
};

export const isDatabaseOverloadedError = (error: unknown): boolean => {
  if (isCurrentDatabaseOverloadError(error)) {
    return true;
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as DatabaseOverloadCandidate;
  return (
    isDatabaseOverloadedError(candidate.cause) ||
    isDatabaseOverloadedError(candidate.originalError)
  );
};

export const resolveMysqlSslCaPath = (sslCaPath: string, appRoot = packageRoot) =>
  path.isAbsolute(sslCaPath) ? sslCaPath : path.resolve(appRoot, sslCaPath);

export const readMysqlSslCa = (sslCa: string | undefined, appRoot = packageRoot) => {
  if (!sslCa) {
    return undefined;
  }

  if (sslCa.includes('BEGIN CERTIFICATE')) {
    return sslCa;
  }

  const resolvedPath = resolveMysqlSslCaPath(sslCa, appRoot);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Configured MySQL SSL CA file was not found: ${resolvedPath}`);
  }

  return readFileSync(resolvedPath, 'utf8');
};

export const getMysqlSslConfig = (
  settings: Pick<MysqlPoolSettings, 'MYSQL_SSL_CA' | 'MYSQL_SSL_MODE'> = env,
  appRoot = packageRoot
) => {
  if (settings.MYSQL_SSL_MODE !== 'REQUIRED') {
    return undefined;
  }

  return {
    ca: readMysqlSslCa(settings.MYSQL_SSL_CA, appRoot),
    rejectUnauthorized: true,
  };
};

export const buildMysqlPoolConfig = (settings: MysqlPoolSettings = env): mysql.PoolOptions => ({
  // Keep both backends aligned: UTC date strings avoid local-time drift, utf8mb4
  // supports full Unicode text, and DECIMAL values are returned as JS numbers
  // consistently for money/FX code that already normalizes numeric inputs.
  charset: MYSQL_POOL_CHARSET,
  connectTimeout: settings.MYSQL_CONNECT_TIMEOUT_MS,
  database: settings.MYSQL_DATABASE,
  dateStrings: true,
  decimalNumbers: MYSQL_POOL_DECIMAL_NUMBERS,
  host: settings.MYSQL_HOST,
  namedPlaceholders: false,
  password: settings.MYSQL_PASSWORD,
  port: settings.MYSQL_PORT,
  ssl: getMysqlSslConfig(settings),
  timezone: MYSQL_POOL_TIMEZONE,
  user: settings.MYSQL_USER,
  waitForConnections: settings.MYSQL_WAIT_FOR_CONNECTIONS,
  connectionLimit: settings.MYSQL_CONNECTION_LIMIT,
  queueLimit: settings.MYSQL_QUEUE_LIMIT,
});

export const getMysqlPool = () => {
  if (!env.MYSQL_HOST || !env.MYSQL_DATABASE || !env.MYSQL_USER || !env.MYSQL_PASSWORD) {
    throw new Error('MySQL environment variables are incomplete for admin_backend.');
  }

  if (!pool) {
    pool = mysql.createPool(buildMysqlPoolConfig());
  }

  return pool;
};

export const queryRows = async <TRow extends RowDataPacket>(
  sql: string,
  params: unknown[] = [],
  executor: QueryExecutor = getMysqlPool()
): Promise<TRow[]> => {
  const [rows] = await executor.query<TRow[]>(sql, params);
  return rows;
};

export const executeStatement = async <TResult extends ResultSetHeader = ResultSetHeader>(
  sql: string,
  params: unknown[] = [],
  executor: QueryExecutor = getMysqlPool()
): Promise<TResult> => {
  const [result] = await executor.execute<TResult>(sql, params as never[]);
  return result;
};

export const withTransaction = async <TResult>(
  callback: (connection: PoolConnection) => Promise<TResult>
): Promise<TResult> => {
  const connection = await getMysqlPool().getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const closeMysqlPool = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};
