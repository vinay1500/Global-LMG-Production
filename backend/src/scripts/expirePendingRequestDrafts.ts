import type { RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env.js';
import { closeMysqlPool, getMysqlPool } from '../lib/mysql.js';
import { selectAll, withTransaction } from '../lib/mysqlUtils.js';

type DraftRow = RowDataPacket & {
  id: number;
  requested_by_user_id: number;
};

const expirePendingRequestDrafts = async () => {
  const expiryMinutes = env.REQUEST_PAYMENT_DRAFT_EXPIRY_MINUTES;
  const expiredCount = await withTransaction(getMysqlPool(), async (connection) => {
    const drafts = await selectAll<DraftRow>(
      connection,
      `SELECT id, requested_by_user_id
       FROM service_requests
       WHERE status_code = 'draft_payment_pending'
         AND archived_at IS NULL
         AND created_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? MINUTE)
       FOR UPDATE`,
      [expiryMinutes]
    );

    for (const draft of drafts) {
      await connection.execute(
        `UPDATE service_requests
         SET status_code = 'lost-closed',
             updated_at = UTC_TIMESTAMP(6),
             row_version = row_version + 1
         WHERE id = ?
           AND status_code = 'draft_payment_pending'`,
        [draft.id]
      );

      await connection.execute(
        `UPDATE payment_gateway_orders
         SET status_code = 'expired',
             updated_at = UTC_TIMESTAMP(6)
         WHERE service_request_id = ?
           AND status_code NOT IN ('paid', 'captured', 'refunded', 'failed', 'cancelled', 'expired')`,
        [draft.id]
      );

      await connection.execute(
        `INSERT INTO request_status_history (
           service_request_id,
           from_status_code,
           to_status_code,
           changed_by_user_id,
           change_note,
           changed_at
         ) VALUES (?, 'draft_payment_pending', 'lost-closed', ?, ?, UTC_TIMESTAMP(6))`,
        [
          draft.id,
          draft.requested_by_user_id,
          `Payment was not completed within ${expiryMinutes} minutes.`,
        ]
      );
    }

    return drafts.length;
  });

  process.stdout.write(`Expired ${expiredCount} pending request draft(s).\n`);
};

expirePendingRequestDrafts()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Draft expiry failed.'}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMysqlPool();
  });
