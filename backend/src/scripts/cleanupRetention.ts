import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ResultSetHeader } from 'mysql2/promise';
import { env } from '../config/env.js';
import { closeMysqlPool, getMysqlPool } from '../lib/mysql.js';

const BATCH_LIMIT = 5000;
export const PROVIDER_EVENT_RETENTION_DAYS = 90;
export const NOTIFICATION_RETENTION_DAYS = env.NOTIFICATION_RETENTION_DAYS;
export const NOTIFICATION_RETENTION_ONLY_DISMISSED = env.NOTIFICATION_RETENTION_ONLY_DISMISSED;

export type RetentionJob = {
  label: string;
  sql: string;
  values?: Array<number>;
};

const deleteJob = (label: string, tableName: string, whereSql: string, values: Array<number>) => ({
  label,
  sql: `DELETE FROM ${tableName} WHERE ${whereSql} LIMIT ${BATCH_LIMIT}`,
  values,
});

export const buildNotificationRetentionJob = (
  retentionDays = NOTIFICATION_RETENTION_DAYS,
  onlyDismissed = NOTIFICATION_RETENTION_ONLY_DISMISSED
): RetentionJob =>
  deleteJob(
    onlyDismissed ? 'notifications_dismissed' : 'notifications_read_or_dismissed',
    'notifications',
    onlyDismissed
      ? 'dismissed_at IS NOT NULL AND dismissed_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)'
      : `(dismissed_at IS NOT NULL OR is_read = 1 OR read_at IS NOT NULL)
         AND COALESCE(dismissed_at, read_at, created_at) < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)`,
    [retentionDays]
  );

export const buildRetentionJobs = (): RetentionJob[] => [
  deleteJob(
    'security_events',
    'security_events',
    'occurred_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)',
    [365]
  ),
  deleteJob(
    'audit_events',
    'audit_events',
    'occurred_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)',
    [365]
  ),
  deleteJob(
    'email_events',
    'email_events',
    'created_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)',
    [PROVIDER_EVENT_RETENTION_DAYS]
  ),
  deleteJob(
    'sms_events',
    'sms_events',
    'created_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)',
    [PROVIDER_EVENT_RETENTION_DAYS]
  ),
  deleteJob(
    'idempotency_keys_completed',
    'idempotency_keys',
    "status_code = 'completed' AND updated_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)",
    [7]
  ),
  {
    label: 'rate_limit_buckets_expired',
    sql: `DELETE FROM rate_limit_buckets
          WHERE window_resets_at < UTC_TIMESTAMP(6)
            AND (blocked_until IS NULL OR blocked_until < UTC_TIMESTAMP(6))
          LIMIT ${BATCH_LIMIT}`,
  },
  deleteJob(
    'auth_flows_expired',
    'auth_flows',
    '(consumed_at IS NOT NULL OR expires_at < UTC_TIMESTAMP(6)) AND updated_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)',
    [30]
  ),
  deleteJob(
    'email_verification_tokens_expired',
    'email_verification_tokens',
    '(consumed_at IS NOT NULL OR expires_at < UTC_TIMESTAMP(6)) AND updated_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)',
    [30]
  ),
  deleteJob(
    'phone_verification_tokens_expired',
    'phone_verification_tokens',
    '(consumed_at IS NOT NULL OR expires_at < UTC_TIMESTAMP(6)) AND updated_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)',
    [30]
  ),
  deleteJob(
    'password_reset_tokens_expired',
    'password_reset_tokens',
    '(consumed_at IS NOT NULL OR expires_at < UTC_TIMESTAMP(6)) AND updated_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? DAY)',
    [30]
  ),
  buildNotificationRetentionJob(),
];

export const retentionJobs: RetentionJob[] = buildRetentionJobs();

export const runRetentionCleanup = async () => {
  const pool = getMysqlPool();
  const summary: Record<string, number> = {};

  for (const job of retentionJobs) {
    const [result] = await pool.execute<ResultSetHeader>(job.sql, job.values || []);
    summary[job.label] = result.affectedRows;
  }

  process.stdout.write(
    `${JSON.stringify({
      deleted: summary,
      event: 'retention.cleanup_completed',
    })}\n`
  );
};

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1]!)).href;

if (isDirectRun) {
  runRetentionCleanup()
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          error: error instanceof Error ? error.message : 'Retention cleanup failed.',
          event: 'retention.cleanup_failed',
        })}\n`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeMysqlPool();
    });
}
