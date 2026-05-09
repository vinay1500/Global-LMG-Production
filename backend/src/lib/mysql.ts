import { readFileSync } from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

let mysqlPool: mysql.Pool | undefined;

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
  if (!mysqlPool) {
    mysqlPool = mysql.createPool({
      connectTimeout: env.MYSQL_CONNECT_TIMEOUT_MS,
      dateStrings: true,
      database: env.MYSQL_DATABASE,
      host: env.MYSQL_HOST,
      password: env.MYSQL_PASSWORD,
      port: env.MYSQL_PORT,
      ssl: getMysqlSslConfig(),
      timezone: 'Z',
      user: env.MYSQL_USER,
      waitForConnections: env.MYSQL_WAIT_FOR_CONNECTIONS,
      connectionLimit: env.MYSQL_CONNECTION_LIMIT,
      queueLimit: env.MYSQL_QUEUE_LIMIT,
    });
  }

  return mysqlPool;
};

export const closeMysqlPool = async () => {
  if (!mysqlPool) {
    return;
  }

  const activePool = mysqlPool;
  mysqlPool = undefined;
  await activePool.end();
};
