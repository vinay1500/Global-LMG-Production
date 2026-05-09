import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeMysqlPool } from './lib/mysql.js';
import { logEvent } from './lib/observability.js';
import { ensurePhase5SchemaReadiness } from './lib/schemaReadiness.js';
import { getGoogleCalendarIdConfig, isGoogleCalendarConfigured } from './modules/events/googleCalendarClient.js';

const logGoogleCalendarConfiguration = () => {
  if (env.CALENDAR_SYNC_MODE !== 'google') {
    return;
  }

  if (
    !env.GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID &&
    !env.GOOGLE_CALENDAR_ID &&
    env.CALENDAR_ADMIN_AUTH_MODE !== 'workspace_delegation'
  ) {
    getGoogleCalendarIdConfig();
  }

  if (!isGoogleCalendarConfigured()) {
    logEvent('warn', 'google_calendar.config_incomplete', {
      adminAuthMode: env.CALENDAR_ADMIN_AUTH_MODE,
      calendarSyncMode: env.CALENDAR_SYNC_MODE,
    });
    return;
  }

  const calendarIdConfig = getGoogleCalendarIdConfig();
  logEvent(
    calendarIdConfig.defaultedToPrimary ? 'warn' : 'info',
    calendarIdConfig.defaultedToPrimary
      ? 'google_calendar.defaulting_to_primary_calendar'
      : 'google_calendar.calendar_id_configured',
    {
      calendarIdSource: calendarIdConfig.source,
      defaultedToPrimary: calendarIdConfig.defaultedToPrimary,
    }
  );
};

const start = async () => {
  await ensurePhase5SchemaReadiness();

  logEvent(
    'info',
    `MySQL pool: connectionLimit=${env.MYSQL_CONNECTION_LIMIT}; queueLimit=${env.MYSQL_QUEUE_LIMIT}; waitForConnections=${env.MYSQL_WAIT_FOR_CONNECTIONS}; connectTimeoutMs=${env.MYSQL_CONNECT_TIMEOUT_MS}`,
    {
      connectTimeoutMs: env.MYSQL_CONNECT_TIMEOUT_MS,
      connectionLimit: env.MYSQL_CONNECTION_LIMIT,
      queueLimit: env.MYSQL_QUEUE_LIMIT,
      waitForConnections: env.MYSQL_WAIT_FOR_CONNECTIONS,
    }
  );

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
  logGoogleCalendarConfiguration();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logEvent('info', 'server.started', { port: env.PORT });
  });

  const shutdown = async () => {
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
  };

  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
};

void start().catch((error) => {
  logEvent('error', 'server.start_failed', {
    errorMessage: error instanceof Error ? error.message : 'Failed to start admin backend.',
    errorStack: env.APP_ENV === 'production' ? undefined : error instanceof Error ? error.stack : undefined,
  });
  void closeMysqlPool().finally(() => process.exit(1));
});
