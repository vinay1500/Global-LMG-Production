import type { RowDataPacket } from 'mysql2/promise';
import { queryRows } from '../../lib/mysql.js';
import type { AdminActor } from '../auth/service.js';
import { listEntries } from '../audit/service.js';
import { listNotifications } from '../notifications/service.js';
import { getWorkspace as getRbacWorkspace } from '../rbac/service.js';

type MetricRow = RowDataPacket & {
  docBacklog: number;
  failedReminders: number;
  openMatters: number;
  pendingInvoices: number;
  pendingReminders: number;
  unreadThreads: number;
};

type StageRow = RowDataPacket & { label: string; value: number };
type RevenueRow = RowDataPacket & { monthLabel: string; revenue: number };
type AgingRow = RowDataPacket & { amount: number; bucket: string };
type AlertRow = RowDataPacket & { staleMatters: number };

export const getWorkspace = async (actor: AdminActor) => {
  const unreadThreadsSql = `(SELECT COUNT(*) FROM conversation_threads WHERE archived_at IS NULL AND status_code = 'waiting') AS unreadThreads`;
  const unreadThreadsParams: unknown[] = [];

  const [metricRows, stageRows, revenueRows, agingRows, alertRows, audit, notifications, rbac] =
    await Promise.all([
      queryRows<MetricRow>(
        `SELECT
           (SELECT COUNT(*) FROM matters WHERE archived_at IS NULL AND operational_status_code NOT IN ('completed', 'archived')) AS openMatters,
           (
             SELECT COUNT(*)
             FROM invoices
             WHERE archived_at IS NULL
               AND amount_due > 0
               AND status_code NOT IN ('paid', 'refunded', 'void')
           ) AS pendingInvoices,
           ${unreadThreadsSql},
           (
             SELECT COUNT(*)
             FROM documents d
             LEFT JOIN document_versions dv ON dv.document_id = d.id AND dv.is_current = 1
             WHERE d.archived_at IS NULL
               AND COALESCE(dv.virus_scan_status_code, 'pending') <> 'clean'
           ) AS docBacklog,
           (
             SELECT COUNT(*)
             FROM event_reminders
             WHERE delivery_status_code = 'failed'
           ) AS failedReminders,
           (
             SELECT COUNT(*)
             FROM event_reminders
             WHERE delivery_status_code = 'pending'
           ) AS pendingReminders`,
        unreadThreadsParams
      ),
      queryRows<StageRow>(
        `SELECT
           COALESCE(ms.label, m.current_stage_code) AS label,
           COUNT(*) AS value
         FROM matters m
         LEFT JOIN matter_stages ms ON ms.code = m.current_stage_code
         WHERE m.archived_at IS NULL
         GROUP BY COALESCE(ms.label, m.current_stage_code), m.current_stage_code
         ORDER BY COUNT(*) DESC, COALESCE(ms.label, m.current_stage_code) ASC
         LIMIT 5`
      ),
      queryRows<RevenueRow>(
        `SELECT
           DATE_FORMAT(months.monthStart, '%b') AS monthLabel,
           COALESCE(SUM(pt.gross_amount), 0) AS revenue
         FROM (
           SELECT DATE_FORMAT(UTC_DATE() - INTERVAL seq.n MONTH, '%Y-%m-01') AS monthStart
           FROM (
             SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2
             UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
           ) AS seq
         ) AS months
         LEFT JOIN payment_transactions pt
           ON DATE_FORMAT(COALESCE(pt.captured_at, pt.created_at), '%Y-%m-01') = months.monthStart
          AND pt.status_code IN ('captured', 'partially-refunded', 'refunded')
         GROUP BY months.monthStart
         ORDER BY months.monthStart ASC`
      ),
      queryRows<AgingRow>(
        `SELECT
           CASE
             WHEN DATEDIFF(UTC_DATE(), due_date) BETWEEN 1 AND 15 THEN '1-15 Days'
             WHEN DATEDIFF(UTC_DATE(), due_date) BETWEEN 16 AND 30 THEN '16-30 Days'
             WHEN DATEDIFF(UTC_DATE(), due_date) BETWEEN 31 AND 60 THEN '31-60 Days'
             WHEN DATEDIFF(UTC_DATE(), due_date) > 60 THEN '60+ Days'
             ELSE 'Current'
           END AS bucket,
           SUM(amount_due) AS amount
         FROM invoices
         WHERE archived_at IS NULL
           AND amount_due > 0
         GROUP BY
           CASE
             WHEN DATEDIFF(UTC_DATE(), due_date) BETWEEN 1 AND 15 THEN '1-15 Days'
             WHEN DATEDIFF(UTC_DATE(), due_date) BETWEEN 16 AND 30 THEN '16-30 Days'
             WHEN DATEDIFF(UTC_DATE(), due_date) BETWEEN 31 AND 60 THEN '31-60 Days'
             WHEN DATEDIFF(UTC_DATE(), due_date) > 60 THEN '60+ Days'
             ELSE 'Current'
           END`
      ),
      queryRows<AlertRow>(
        `SELECT
           COUNT(*) AS staleMatters
         FROM matters
         WHERE archived_at IS NULL
           AND operational_status_code NOT IN ('completed', 'archived')
           AND last_activity_at < UTC_TIMESTAMP(6) - INTERVAL 14 DAY`
      ),
      listEntries({ limit: 5 }),
      listNotifications(actor, { limit: 5 }),
      getRbacWorkspace(),
    ]);

  const metrics = metricRows[0] || {
    docBacklog: 0,
    failedReminders: 0,
    openMatters: 0,
    pendingInvoices: 0,
    pendingReminders: 0,
    unreadThreads: 0,
  };

  const staleMatters = alertRows[0]?.staleMatters || 0;

  return {
    accessOverview: {
      roles: rbac.roles.slice(0, 6),
      users: rbac.users.slice(0, 6),
    },
    alertBanner: {
      staleMatters,
      summary:
        staleMatters > 0
          ? `${staleMatters} matters are stale for 14+ days and need operator attention.`
          : 'No stale matters are currently outside the 14-day attention window.',
    },
    aging: ['1-15 Days', '16-30 Days', '31-60 Days', '60+ Days'].map((bucket) => ({
      amount: agingRows.find((row) => row.bucket === bucket)?.amount || 0,
      bucket,
    })),
    metrics: {
      docBacklog: metrics.docBacklog,
      failedReminders: metrics.failedReminders,
      openMatters: metrics.openMatters,
      pendingInvoices: metrics.pendingInvoices,
      pendingReminders: metrics.pendingReminders,
      unreadThreads: metrics.unreadThreads,
    },
    recentAudit: audit.entries,
    recentNotifications: notifications.notifications,
    revenueTrend: revenueRows.map((row) => ({
      month: row.monthLabel,
      revenue: row.revenue,
    })),
    stageMix: stageRows.map((row) => ({
      name: row.label,
      value: row.value,
    })),
  };
};
