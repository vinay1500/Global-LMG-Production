import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeMysqlPool } from './lib/mysql.js';
import { logEvent } from './lib/observability.js';
import { ensurePhase5SchemaReadiness } from './lib/schemaReadiness.js';

const start = async () => {
  await ensurePhase5SchemaReadiness();

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
