import { createApp } from './app.js';
import { env } from './config/env.js';
import { ensureDatabaseMigrations } from './lib/migrations.js';
import { closeMysqlPool } from './lib/mysql.js';
import { logEvent } from './lib/observability.js';
import { documentStorageService } from './modules/storage/service.js';

const isMysqlConfigured = Boolean(
  env.MYSQL_HOST && env.MYSQL_DATABASE && env.MYSQL_USER && env.MYSQL_PASSWORD
);

const requiresMysqlOnStartup = true;

type StartupStage = 'database_warmup' | 'document_storage_startup';

type StartupError = Error & {
  cause?: unknown;
  code?: string;
  originalError?: unknown;
  startupStage?: StartupStage;
};

const serializeError = (error: unknown): unknown =>
  error instanceof Error
    ? {
        code: (error as StartupError).code,
        message: error.message,
        name: error.name,
        stack: error.stack,
        startupStage: (error as StartupError).startupStage,
        cause: (error as StartupError).cause
          ? serializeError((error as StartupError).cause)
          : undefined,
        originalError: (error as StartupError).originalError
          ? serializeError((error as StartupError).originalError)
          : undefined,
      }
    : error;

const getBootstrapHint = (error: unknown) => {
  const startupError = error as StartupError | undefined;
  const originalError =
    startupError?.originalError instanceof Error
      ? (startupError.originalError as StartupError)
      : error instanceof Error
        ? (error as StartupError)
        : null;

  if (!originalError) {
    return undefined;
  }

  switch (originalError.code) {
    case 'ENOTFOUND':
      return 'The configured MySQL host could not be resolved. Verify local DNS/network access or update the MYSQL_* env vars to a reachable database before Phase 10 smoke tests.';
    case 'ECONNREFUSED':
      return 'The configured MySQL host refused the connection. Verify the MySQL server is running, reachable, and accepting the configured port.';
    case 'ETIMEDOUT':
      return 'The MySQL connection attempt timed out. Verify firewall/network access and the configured MYSQL_HOST / MYSQL_PORT values.';
    default:
      return undefined;
  }
};

const withStartupStage = async <T>(stage: StartupStage, callback: () => Promise<T>) => {
  try {
    return await callback();
  } catch (error) {
    const wrapped = new Error(`Startup failed during ${stage}.`, {
      cause: error instanceof Error ? error : undefined,
    }) as StartupError;
    wrapped.originalError = error;
    wrapped.startupStage = stage;
    throw wrapped;
  }
};

const warmDatabase = async () => {
  if (!isMysqlConfigured) {
    if (requiresMysqlOnStartup) {
      throw new Error(
        'MySQL is required on startup, but MYSQL_HOST, MYSQL_DATABASE, MYSQL_USER, or MYSQL_PASSWORD is missing.'
      );
    }

    return;
  }

  try {
    await ensureDatabaseMigrations();
  } catch (error) {
    if (requiresMysqlOnStartup) {
      throw error;
    }

    logEvent('warn', 'server.database_warmup_skipped', {
      error: serializeError(error),
      reason: 'mysql_unavailable',
    });
  }
};

const bootstrap = async () => {
  await withStartupStage('database_warmup', warmDatabase);
  await withStartupStage('document_storage_startup', () => documentStorageService.onStartup());

  logEvent(
    'info',
    `Malware scan: ${env.FILE_SCAN_MODE}; block-until-clean: download=${env.FILE_SCAN_BLOCK_DOWNLOAD_UNTIL_CLEAN} preview=${env.FILE_SCAN_BLOCK_PREVIEW_UNTIL_CLEAN}`,
    {
      blockDownloadUntilClean: env.FILE_SCAN_BLOCK_DOWNLOAD_UNTIL_CLEAN,
      blockPreviewUntilClean: env.FILE_SCAN_BLOCK_PREVIEW_UNTIL_CLEAN,
      forcedByNonDevelopment: env.APP_ENV !== 'development',
      scanMode: env.FILE_SCAN_MODE,
    }
  );

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logEvent('info', 'server.started', {
      port: env.PORT,
      publicWebOrigin: env.PUBLIC_WEB_ORIGIN,
    });
  });

  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logEvent('warn', 'server.shutdown_requested', { signal });

    const shutdownTimer = setTimeout(() => {
      logEvent('error', 'server.shutdown_timeout', {
        timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
      });
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      await closeMysqlPool();
      clearTimeout(shutdownTimer);
      logEvent('info', 'server.stopped', { signal });
      process.exit(0);
    } catch (error) {
      clearTimeout(shutdownTimer);
      logEvent('error', 'server.shutdown_failed', {
        error: serializeError(error),
        signal,
      });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
};

void bootstrap().catch(async (error) => {
  logEvent('error', 'server.bootstrap_failed', {
    bootstrapHint: getBootstrapHint(error),
    error: serializeError(error),
    mysqlConfigured: isMysqlConfigured,
  });
  await closeMysqlPool();
  process.exit(1);
});
