import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env.js';
import { createPublicId } from '../lib/ids.js';
import { closeMysqlPool, getMysqlPool } from '../lib/mysql.js';
import { toMysqlDateTime } from '../lib/datetime.js';

interface PendingScanRow extends RowDataPacket {
  document_id: number;
  document_version_id: number;
  original_file_name: string;
}

const insertScanFailedAuditEvent = async (
  connection: PoolConnection,
  row: PendingScanRow,
  occurredAt: string
) => {
  await connection.execute(
    `INSERT INTO audit_events (
       public_id, actor_user_id, actor_role_code_snapshot, entity_table_name, entity_pk,
       action_code, action_label, source_module, request_correlation_id, ip_address, user_agent,
       summary_old_value, summary_new_value, occurred_at
     ) VALUES (?, NULL, 'system', 'documents', ?, 'document.scan_failed', 'Document scan failed',
       'document_scan_sweeper', NULL, NULL, NULL, 'pending_scan', ?, ?)`,
    [
      createPublicId(),
      row.document_id,
      `Scan did not complete in time: ${row.original_file_name}`,
      occurredAt,
    ]
  );
};

const main = async () => {
  const pool = getMysqlPool();
  const timeoutMinutes = env.FILE_SCAN_PENDING_TIMEOUT_MINUTES;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query<PendingScanRow[]>(
      `SELECT
         dv.id AS document_version_id,
         dv.document_id,
         dv.original_file_name
       FROM document_versions dv
       WHERE dv.virus_scan_status_code = 'pending_scan'
         AND dv.uploaded_at < TIMESTAMPADD(MINUTE, -?, UTC_TIMESTAMP(6))
       LIMIT 500
       FOR UPDATE`,
      [timeoutMinutes]
    );

    const occurredAt = toMysqlDateTime(new Date());
    for (const row of rows) {
      await connection.execute(
        `UPDATE document_versions
         SET virus_scan_status_code = 'scan_failed',
             scan_provider_code = COALESCE(scan_provider_code, ?),
             scan_checked_at = ?,
             scan_error_text = ?,
             quarantine_flag = 0
         WHERE id = ?
           AND virus_scan_status_code = 'pending_scan'`,
        [
          env.FILE_SCAN_MODE === 'clamav' ? 'clamav' : 'disabled',
          occurredAt,
          'Scan did not complete in time.',
          row.document_version_id,
        ]
      );

      await insertScanFailedAuditEvent(connection, row, occurredAt);
    }

    await connection.commit();
    console.log(`Expired ${rows.length} pending document scan(s).`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await closeMysqlPool();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Pending document scan expiry failed.');
  process.exitCode = 1;
});
