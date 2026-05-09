import { type Request, type Response, Router } from 'express';
import { env } from '../config/env.js';
import { asyncHandler } from '../lib/httpErrors.js';
import { getMysqlPool } from '../lib/mysql.js';
import { ensurePhase5SchemaReadiness } from '../lib/schemaReadiness.js';
import { isGoogleCalendarConfigured } from '../modules/events/googleCalendarClient.js';

export const healthRouter = Router();

const HEALTH_READY_SUCCESS_CACHE_MS = 30_000;
const HEALTH_READY_FAILURE_CACHE_MS = 5_000;

const isMysqlConfigured = Boolean(
  env.MYSQL_HOST && env.MYSQL_DATABASE && env.MYSQL_USER && env.MYSQL_PASSWORD
);

type ReadinessCheck = {
  configured?: boolean;
  error?: string;
  ready: boolean;
  status: string;
};

let mysqlReadinessCache:
  | {
      checkedAtMs: number;
      expiresAtMs: number;
      value: ReadinessCheck;
    }
  | null = null;

let schemaReadinessCache:
  | {
      checkedAtMs: number;
      expiresAtMs: number;
      value: ReadinessCheck;
    }
  | null = null;

const withCacheMetadata = <TValue extends ReadinessCheck>(
  value: TValue,
  checkedAtMs: number,
  cached: boolean
) => ({
  ...value,
  cacheAgeSeconds: Math.max(0, Math.floor((Date.now() - checkedAtMs) / 1000)),
  cached,
  checkedAt: new Date(checkedAtMs).toISOString(),
});

const probeMysqlReadiness = async (): Promise<ReadinessCheck> => {
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

const probeSchemaReadiness = async (mysqlReady: boolean): Promise<ReadinessCheck> => {
  if (!mysqlReady) {
    return {
      ready: false,
      status: 'blocked-by-mysql',
    };
  }

  try {
    await ensurePhase5SchemaReadiness();
    return {
      ready: true,
      status: 'ok',
    };
  } catch (error) {
    return {
      ready: false,
      status: 'missing-required-schema',
      error: error instanceof Error ? error.message : 'Unknown schema readiness error',
    };
  }
};

const getSchemaReadiness = async (mysqlReady: boolean) => {
  if (!mysqlReady) {
    return withCacheMetadata(
      {
        ready: false,
        status: 'blocked-by-mysql',
      },
      Date.now(),
      false
    );
  }

  const now = Date.now();

  if (schemaReadinessCache && schemaReadinessCache.expiresAtMs > now) {
    return withCacheMetadata(schemaReadinessCache.value, schemaReadinessCache.checkedAtMs, true);
  }

  const value = await probeSchemaReadiness(mysqlReady);
  schemaReadinessCache = {
    checkedAtMs: now,
    expiresAtMs: now + (value.ready ? HEALTH_READY_SUCCESS_CACHE_MS : HEALTH_READY_FAILURE_CACHE_MS),
    value,
  };

  return withCacheMetadata(value, now, false);
};

export const getCalendarReadiness = () => {
  if (env.CALENDAR_SYNC_MODE !== 'google') {
    return {
      configured: false,
      ready: true,
      status: 'disabled',
    };
  }

  if (isGoogleCalendarConfigured()) {
    return {
      configured: true,
      ready: true,
      status: 'ok',
    };
  }

  return {
    configured: false,
    ready: false,
    status: 'calendar_config_incomplete',
  };
};

const respondLive = (_request: Request, response: Response) => {
  response.json({
    environment: env.APP_ENV,
    service: 'global-lmg-admin-api',
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
};

healthRouter.get('/health', respondLive);
healthRouter.get('/health/live', respondLive);

healthRouter.get(
  '/health/ready',
  asyncHandler(async (_request, response) => {
    const mysql = await getMysqlReadiness();
    const schema = await getSchemaReadiness(mysql.ready);
    const calendar = getCalendarReadiness();
    const ready = mysql.ready && schema.ready && calendar.ready;

    response.status(ready ? 200 : 503).json({
      checks: {
        calendar,
        mysql,
        schema,
      },
      environment: env.APP_ENV,
      service: 'global-lmg-admin-api',
      status: ready ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  })
);
