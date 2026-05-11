import { closeMysqlPool } from '../lib/mysql.js';
import { logEvent } from '../lib/observability.js';
import { revokeUnsafeAdminSessions } from '../modules/auth/service.js';

const main = async () => {
  const result = await revokeUnsafeAdminSessions();
  logEvent('info', 'admin.sessions_revoke_unsafe_completed', {
    affectedRows: result.affectedRows,
  });
};

main()
  .catch((error) => {
    logEvent('error', 'admin.sessions_revoke_unsafe_failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMysqlPool();
  });
