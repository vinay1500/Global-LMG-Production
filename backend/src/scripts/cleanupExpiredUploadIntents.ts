import type { ResultSetHeader } from 'mysql2/promise';
import { closeMysqlPool, getMysqlPool } from '../lib/mysql.js';

const main = async () => {
  const pool = getMysqlPool();
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE document_upload_intents
     SET status_code = 'failed'
     WHERE status_code = 'pending'
       AND stored_at IS NULL
       AND expires_at < UTC_TIMESTAMP(6)`
  );

  process.stdout.write(
    `${JSON.stringify({
      event: 'uploads.expired_intents_cleaned',
      expired: result.affectedRows,
    })}\n`
  );
};

main()
  .catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        error: error instanceof Error ? error.message : 'Expired upload intent cleanup failed.',
        event: 'uploads.expired_intents_cleanup_failed',
      })}\n`
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMysqlPool();
  });
