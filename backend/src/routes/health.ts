import { type Request, type Response, Router } from 'express';
import { env } from '../config/env.js';
import { getMysqlPool } from '../lib/mysql.js';
import { asyncHandler } from '../lib/httpErrors.js';

export const healthRouter = Router();

const HEALTH_READY_SUCCESS_CACHE_MS = 30_000;
const HEALTH_READY_FAILURE_CACHE_MS = 5_000;

const isMysqlConfigured = Boolean(
  env.MYSQL_HOST && env.MYSQL_DATABASE && env.MYSQL_USER && env.MYSQL_PASSWORD
);

type MysqlReadiness = {
  configured: boolean;
  error?: string;
  ready: boolean;
  status: string;
};

let mysqlReadinessCache:
  | {
      checkedAtMs: number;
      expiresAtMs: number;
      value: MysqlReadiness;
    }
  | null = null;

const withCacheMetadata = (value: MysqlReadiness, checkedAtMs: number, cached: boolean) => ({
  ...value,
  cacheAgeSeconds: Math.max(0, Math.floor((Date.now() - checkedAtMs) / 1000)),
  cached,
  checkedAt: new Date(checkedAtMs).toISOString(),
});

const probeMysqlReadiness = async (): Promise<MysqlReadiness> => {
  if (!isMysqlConfigured) {
    return {
      configured: false,
      ready: false,
      status: 'required-but-missing',
    };
  }

  try {
    await getMysqlPool().query('SELECT 1');
    return {
      configured: true,
      ready: true,
      status: 'ok',
    };
  } catch (error) {
    return {
      configured: true,
      ready: false,
      status: 'unreachable',
      error: error instanceof Error ? error.message : 'Unknown MySQL error',
    };
  }
};

const getMysqlReadiness = async () => {
  const now = Date.now();

  if (mysqlReadinessCache && mysqlReadinessCache.expiresAtMs > now) {
    return withCacheMetadata(mysqlReadinessCache.value, mysqlReadinessCache.checkedAtMs, true);
  }

  const value = await probeMysqlReadiness();
  mysqlReadinessCache = {
    checkedAtMs: now,
    expiresAtMs: now + (value.ready ? HEALTH_READY_SUCCESS_CACHE_MS : HEALTH_READY_FAILURE_CACHE_MS),
    value,
  };

  return withCacheMetadata(value, now, false);
};

const respondLive = (_request: Request, response: Response) => {
  response.json({
    environment: env.APP_ENV,
    service: 'global-lmg-api',
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
};

healthRouter.get('/health', respondLive);
healthRouter.get('/health/live', respondLive);

healthRouter.get(
  '/health/ready',
  asyncHandler(async (_request: Request, response: Response) => {
    const mysql = await getMysqlReadiness();
    const ready = mysql.ready;

    response.status(ready ? 200 : 503).json({
      checks: {
        mysql,
        storage: {
          mode: env.DASHBOARD_STORE_MODE,
          ready,
        },
      },
      environment: env.APP_ENV,
      service: 'global-lmg-api',
      status: ready ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  })
);
