import { readFileSync } from 'node:fs';
import path from 'node:path';
import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';
import { env } from '../config/env.js';

let pool: Pool | null = null;

export type QueryExecutor = Pick<Pool | PoolConnection, 'execute' | 'query'>;

const getMysqlSslConfig = () => {
  if (env.MYSQL_SSL_MODE !== 'REQUIRED') {
    return undefined;
  }

  return {
    ca: env.MYSQL_SSL_CA
      ? readFileSync(path.resolve(process.cwd(), env.MYSQL_SSL_CA), 'utf8')
      : undefined,
    rejectUnauthorized: true,
  };
};

export const getMysqlPool = () => {
  if (!env.MYSQL_HOST || !env.MYSQL_DATABASE || !env.MYSQL_USER || !env.MYSQL_PASSWORD) {
    throw new Error('MySQL environment variables are incomplete for admin_backend.');
  }

  if (!pool) {
    pool = mysql.createPool({
      charset: 'utf8mb4',
      connectTimeout: env.MYSQL_CONNECT_TIMEOUT_MS,
      database: env.MYSQL_DATABASE,
      dateStrings: true,
      decimalNumbers: true,
      host: env.MYSQL_HOST,
      namedPlaceholders: false,
      password: env.MYSQL_PASSWORD,
      port: env.MYSQL_PORT,
      ssl: getMysqlSslConfig(),
      user: env.MYSQL_USER,
      waitForConnections: env.MYSQL_WAIT_FOR_CONNECTIONS,
      connectionLimit: env.MYSQL_CONNECTION_LIMIT,
      queueLimit: env.MYSQL_QUEUE_LIMIT,
    });
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
