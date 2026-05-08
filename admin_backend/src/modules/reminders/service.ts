import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { env } from '../../config/env.js';
import { createPublicId } from '../../lib/authCrypto.js';
import { badRequest, notFound } from '../../lib/httpErrors.js';
import { executeStatement, queryRows, withTransaction, type QueryExecutor } from '../../lib/mysql.js';
import { toUiDateTime } from '../../lib/viewModels.js';
import type { AdminActor } from '../auth/service.js';
import { sendEmail } from '../providers/email.js';
import { sendSms } from '../providers/sms.js';
import type { ProviderDeliveryResult } from '../providers/types.js';
import { createAuditEvent } from '../writeSupport.js';

type ReminderStatus = 'cancelled' | 'failed' | 'pending' | 'processing' | 'sent';

type ReminderProcessingRow = RowDataPacket & {
  channelCode: string;
  clientAccountId: number;
  clientName: string | null;
  deliveryStatusCode: ReminderStatus;
  eventId: number;
  eventPublicId: string;
  eventStatusCode: string;
  eventTitle: string;
  eventTypeCode: string;
  failureReason: string | null;
  id: number;
  matterId: number | null;
  maxAttempts: number;
  recipientEmail: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  recipientUserId: number;
  retryCount: number;
  scheduledAt: string;
  scheduledStartAt: string;
  visibleToClient: number;
};

type ReminderListRow = ReminderProcessingRow & {
  lockedAt: string | null;
  lockedBy: string | null;
  nextAttemptAt: string | null;
  processedAt: string | null;
  sentAt: string | null;
};

type ReminderMetricRow = RowDataPacket & {
  due: number;
  failed: number;
  pending: number;
  processing: number;
  sentRecent: number;
};
type ReminderDeliverySettingRow = RowDataPacket & {
  bodyText: string | null;
  inAppEnabled: number;
  isActive: number;
  subject: string | null;
  templateId: string | null;
};

type MarkReminderFailedInput = {
  actor?: AdminActor | null;
  error: unknown;
  lockId: string;
  providerResult?: ProviderDeliveryResult;
  reminderId: number;
};

const LOCK_TTL_MINUTES = 15;
const RETRY_DELAY_MINUTES = 10;

const providerMode = () => ({
  email: env.EMAIL_PROVIDER_MODE,
  inApp: 'local' as const,
  sms: env.SMS_PROVIDER_MODE,
});

const truncate = (value: string, maxLength = 255) =>
  value.length > maxLength ? value.slice(0, maxLength - 1) : value;

const safeErrorMessage = (error: unknown) =>
  error instanceof Error ? truncate(error.message) : 'Unknown reminder processing failure.';

const normalizeLimit = (limit?: number) =>
  Math.max(1, Math.min(limit || env.REMINDER_PROCESS_BATCH_SIZE, 100));

const formatDateTimeForCopy = (value: string) => value.slice(0, 16).replace(' ', ' at ');

const renderTemplate = (value: string, context: Record<string, string>) =>
  value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, variable: string) => context[variable] || '');

const deliveryLabelFor = (channelCode: string, result?: ProviderDeliveryResult) => {
  if (channelCode === 'email') {
    if (result?.status === 'sent') {
      return 'Email reminder sent via Resend.';
    }

    if (result?.status === 'preview') {
      return 'Email provider preview mode; no external email was sent.';
    }

    if (result?.status === 'failed') {
      return 'Email delivery failed; retry is available from the reminder queue.';
    }

    return env.EMAIL_PROVIDER_MODE === 'disabled'
      ? 'Email provider disabled; in-app/local reminder only.'
      : 'Email reminder delivery pending provider processing.';
  }

  if (channelCode === 'sms') {
    if (result?.status === 'sent') {
      return 'SMS reminder sent via Twilio.';
    }

    if (result?.status === 'preview') {
      return 'SMS provider preview mode; no external SMS was sent.';
    }

    if (result?.status === 'failed') {
      return 'SMS delivery failed; retry is available from the reminder queue.';
    }

    return env.SMS_PROVIDER_MODE === 'disabled'
      ? 'SMS provider disabled; in-app/local reminder only.'
      : 'SMS reminder delivery pending provider processing.';
  }

  return 'In-app/local reminder created.';
};

const buildNotificationPayload = (row: ReminderProcessingRow) => ({
  bodyText: `${row.eventTitle} is scheduled for ${formatDateTimeForCopy(
    row.scheduledStartAt
  )}.`,
  title: `Reminder: ${row.eventTitle}`,
});

const getReminderDeliverySetting = async (executor: QueryExecutor) => {
  const rows = await queryRows<ReminderDeliverySettingRow>(
    `SELECT
       COALESCE(nds.in_app_enabled, 1) AS inAppEnabled,
       COALESCE(nds.is_active, nt.is_active) AS isActive,
       at.public_id AS templateId,
       at.subject,
       at.body_text AS bodyText
     FROM notification_types nt
     LEFT JOIN notification_delivery_settings nds ON nds.notification_type_code = nt.code
     LEFT JOIN admin_templates at ON at.public_id = nds.template_public_id
       AND at.template_type_code = 'notification'
       AND at.is_active = 1
       AND at.archived_at IS NULL
     WHERE nt.code = 'event_reminder'
     LIMIT 1`,
    [],
    executor
  );

  return rows[0] || { bodyText: null, inAppEnabled: 1, isActive: 1, subject: null, templateId: null };
};

const selectReminderForProcessing = async (
  reminderId: number,
  lockId: string,
  executor: QueryExecutor
) => {
  const rows = await queryRows<ReminderProcessingRow>(
    `SELECT
       er.id,
       er.event_id AS eventId,
       er.recipient_user_id AS recipientUserId,
       er.channel_code AS channelCode,
       er.scheduled_at AS scheduledAt,
       er.delivery_status_code AS deliveryStatusCode,
       er.failure_reason AS failureReason,
       er.retry_count AS retryCount,
       er.max_attempts AS maxAttempts,
       evt.public_id AS eventPublicId,
       evt.title AS eventTitle,
       evt.event_type_code AS eventTypeCode,
       evt.status_code AS eventStatusCode,
       evt.scheduled_start_at AS scheduledStartAt,
       evt.client_account_id AS clientAccountId,
       evt.matter_id AS matterId,
       evt.client_visible_flag AS visibleToClient,
       client.display_name AS clientName,
       recipient.display_name AS recipientName,
       recipient.email AS recipientEmail,
       recipient.phone AS recipientPhone
     FROM event_reminders er
     INNER JOIN events evt ON evt.id = er.event_id
     INNER JOIN users recipient ON recipient.id = er.recipient_user_id
     LEFT JOIN client_accounts client ON client.id = evt.client_account_id
     WHERE er.id = ?
       AND er.locked_by = ?
       AND er.delivery_status_code = 'processing'
     LIMIT 1`,
    [reminderId, lockId],
    executor
  );

  return rows[0] || null;
};

const auditReminder = async (
  input: {
    actionCode: string;
    actionLabel: string;
    actor?: AdminActor | null;
    changes?: Array<{ fieldName: string; newValue?: unknown; oldValue?: unknown }>;
    eventId: number;
    sourceModule?: string;
    summaryNewValue?: unknown;
    summaryOldValue?: unknown;
  },
  executor?: QueryExecutor
) =>
  createAuditEvent(
    {
      actionCode: input.actionCode,
      actionLabel: input.actionLabel,
      actorRoleCode: input.actor?.roleCodes[0] || 'system',
      actorUserId: input.actor?.userId || null,
      changes: input.changes,
      entityPk: input.eventId,
      entityTableName: 'event_reminders',
      sourceModule: input.sourceModule || 'reminder_processor',
      summaryNewValue: input.summaryNewValue,
      summaryOldValue: input.summaryOldValue,
    },
    executor
  );

const insertNotificationIfNeeded = async (
  row: ReminderProcessingRow,
  executor: QueryExecutor
) => {
  const deliverySetting = await getReminderDeliverySetting(executor);
  if (!deliverySetting.isActive || !deliverySetting.inAppEnabled) {
    return { created: false, notificationId: 0, payload: buildNotificationPayload(row), suppressed: true };
  }

  const defaultPayload = buildNotificationPayload(row);
  const templateContext = {
    actionUrl: '',
    clientName: row.clientName || row.recipientName || 'Client',
    matterTitle: row.eventTitle,
    platformName: 'Global LMG',
  };
  const payload = {
    bodyText: deliverySetting.bodyText
      ? renderTemplate(deliverySetting.bodyText, templateContext)
      : defaultPayload.bodyText,
    title: deliverySetting.subject
      ? renderTemplate(deliverySetting.subject, templateContext)
      : defaultPayload.title,
  };
  const existing = await queryRows<RowDataPacket & { id: number }>(
    `SELECT id
     FROM notifications
     WHERE recipient_user_id = ?
       AND event_id = ?
       AND notification_type_code = 'event_reminder'
       AND title = ?
       AND body_text = ?
     LIMIT 1`,
    [row.recipientUserId, row.eventId, payload.title, payload.bodyText],
    executor
  );

  if (existing[0]) {
    return { created: false, notificationId: Number(existing[0].id), payload, suppressed: false };
  }

  const result = await executeStatement(
    `INSERT INTO notifications (
       public_id,
       recipient_user_id,
       notification_type_code,
       title,
       body_text,
       priority_code,
       matter_id,
       invoice_id,
       thread_id,
       event_id,
       document_id,
       is_read,
       read_at,
       dismissed_at,
       created_at,
       expires_at
     ) VALUES (?, ?, 'event_reminder', ?, ?, 'normal', ?, NULL, NULL, ?, NULL, 0, NULL, NULL, UTC_TIMESTAMP(6), NULL)`,
    [createPublicId(), row.recipientUserId, payload.title, payload.bodyText, row.matterId, row.eventId],
    executor
  );

  return { created: true, notificationId: result.insertId, payload, suppressed: false };
};

const dispatchReminderChannel = async (row: ReminderProcessingRow, payload: { bodyText: string; title: string }) => {
  if (row.channelCode === 'email') {
    if (!row.recipientEmail) {
      return {
        errorMessage: 'Reminder recipient has no email address.',
        providerCode: 'local',
        status: 'failed',
      } satisfies ProviderDeliveryResult;
    }

    return sendEmail({
      subject: payload.title,
      text: payload.bodyText,
      to: row.recipientEmail,
    });
  }

  if (row.channelCode === 'sms') {
    if (!row.recipientPhone) {
      return {
        errorMessage: 'Reminder recipient has no phone number.',
        providerCode: 'local',
        status: 'failed',
      } satisfies ProviderDeliveryResult;
    }

    return sendSms({
      body: truncate(`${payload.title}\n${payload.bodyText}`, 1200),
      to: row.recipientPhone,
    });
  }

  return {
    providerCode: 'local',
    status: 'sent',
  } satisfies ProviderDeliveryResult;
};

const completeLockedReminder = async (
  reminderId: number,
  lockId: string,
  actor?: AdminActor | null
) =>
  withTransaction(async (connection) => {
    const row = await selectReminderForProcessing(reminderId, lockId, connection);

    if (!row) {
      throw notFound('reminder_not_found', 'Reminder is no longer locked for processing.');
    }

    if (row.eventStatusCode === 'cancelled' || row.visibleToClient !== 1) {
      await executeStatement(
        `UPDATE event_reminders
         SET delivery_status_code = 'cancelled',
             failure_reason = 'Event is cancelled or not client-visible.',
             next_attempt_at = NULL,
             locked_at = NULL,
             locked_by = NULL,
             processed_at = UTC_TIMESTAMP(6)
         WHERE id = ?`,
        [row.id],
        connection
      );

      await auditReminder(
        {
          actionCode: 'reminder.processed',
          actionLabel: 'Reminder skipped',
          actor,
          changes: [
            { fieldName: 'delivery_status_code', oldValue: 'processing', newValue: 'cancelled' },
          ],
          eventId: row.eventId,
          summaryNewValue: 'Reminder skipped because the event is cancelled or not client-visible.',
        },
        connection
      );

      return { createdNotification: false, reminderId: String(row.id), status: 'skipped' as const };
    }

    const notificationResult = await insertNotificationIfNeeded(row, connection);
    const providerResult = await dispatchReminderChannel(row, notificationResult.payload);

    if (providerResult.status === 'failed') {
      const message = providerResult.errorMessage || 'Reminder provider delivery failed.';
      await markReminderFailedInCurrentTransaction(
        {
          actor,
          error: new Error(message),
          lockId,
          providerResult,
          reminderId: row.id,
        },
        connection
      );

      return {
        createdNotification: notificationResult.created,
        reminderId: String(row.id),
        status: 'failed' as const,
      };
    }

    await executeStatement(
      `UPDATE event_reminders
       SET delivery_status_code = 'sent',
           sent_at = COALESCE(sent_at, UTC_TIMESTAMP(6)),
           failure_reason = NULL,
           next_attempt_at = NULL,
           locked_at = NULL,
           locked_by = NULL,
           processed_at = UTC_TIMESTAMP(6)
       WHERE id = ?`,
      [row.id],
      connection
    );

    await auditReminder(
      {
        actionCode: 'reminder.processed',
        actionLabel: 'Reminder processed',
        actor,
        changes: [
          { fieldName: 'delivery_status_code', oldValue: 'processing', newValue: 'sent' },
          { fieldName: 'delivery_mode', newValue: deliveryLabelFor(row.channelCode, providerResult) },
          { fieldName: 'provider_code', newValue: providerResult.providerCode },
          { fieldName: 'provider_reference', newValue: providerResult.providerReference || null },
        ],
        eventId: row.eventId,
        summaryNewValue: notificationResult.created
          ? deliveryLabelFor(row.channelCode, providerResult)
          : notificationResult.suppressed
            ? 'Reminder notification suppressed by notification settings.'
          : `Existing in-app/local reminder notification reused. ${deliveryLabelFor(
              row.channelCode,
              providerResult
            )}`,
      },
      connection
    );

    return {
      createdNotification: notificationResult.created,
      reminderId: String(row.id),
      status: notificationResult.created ? ('sent' as const) : ('already_notified' as const),
    };
  });

const markReminderFailedInCurrentTransaction = async (
  input: MarkReminderFailedInput,
  connection: QueryExecutor
) => {
    const rows = await queryRows<ReminderProcessingRow>(
      `SELECT
         er.id,
         er.event_id AS eventId,
         er.delivery_status_code AS deliveryStatusCode,
         er.retry_count AS retryCount,
         er.max_attempts AS maxAttempts,
         evt.public_id AS eventPublicId,
         evt.title AS eventTitle,
         evt.event_type_code AS eventTypeCode,
         evt.status_code AS eventStatusCode,
         evt.scheduled_start_at AS scheduledStartAt,
         evt.client_account_id AS clientAccountId,
         evt.matter_id AS matterId,
         evt.client_visible_flag AS visibleToClient,
         er.recipient_user_id AS recipientUserId,
         er.channel_code AS channelCode,
         er.scheduled_at AS scheduledAt,
         er.failure_reason AS failureReason,
         client.display_name AS clientName,
         recipient.display_name AS recipientName,
         recipient.email AS recipientEmail,
         recipient.phone AS recipientPhone
       FROM event_reminders er
       INNER JOIN events evt ON evt.id = er.event_id
       INNER JOIN users recipient ON recipient.id = er.recipient_user_id
       LEFT JOIN client_accounts client ON client.id = evt.client_account_id
       WHERE er.id = ?
         AND er.locked_by = ?
       LIMIT 1`,
      [input.reminderId, input.lockId],
      connection
    );
    const row = rows[0];

    if (!row) {
      return;
    }

    const message = safeErrorMessage(input.error);
    const nextRetryCount = Number(row.retryCount || 0) + 1;
    await executeStatement(
      `UPDATE event_reminders
       SET delivery_status_code = 'failed',
           failure_reason = ?,
           next_attempt_at = CASE
             WHEN retry_count + 1 < max_attempts THEN DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ${RETRY_DELAY_MINUTES} MINUTE)
             ELSE NULL
           END,
           retry_count = retry_count + 1,
           locked_at = NULL,
           locked_by = NULL,
           processed_at = UTC_TIMESTAMP(6)
       WHERE id = ?`,
      [message, row.id],
      connection
    );

    await auditReminder(
      {
        actionCode: 'reminder.failed',
        actionLabel: input.providerResult ? 'Reminder delivery failed' : 'Reminder processing failed',
        actor: input.actor,
        changes: [
          { fieldName: 'delivery_status_code', oldValue: 'processing', newValue: 'failed' },
          ...(input.providerResult
            ? [
                {
                  fieldName: 'delivery_mode',
                  newValue: deliveryLabelFor(row.channelCode, input.providerResult),
                },
                { fieldName: 'provider_code', newValue: input.providerResult.providerCode },
                {
                  fieldName: 'provider_reference',
                  newValue: input.providerResult.providerReference || null,
                },
              ]
            : []),
          { fieldName: 'retry_count', oldValue: Number(row.retryCount || 0), newValue: nextRetryCount },
          { fieldName: 'last_error', newValue: message },
        ],
        eventId: row.eventId,
        summaryNewValue: message,
      },
      connection
    );
  };

const markReminderFailed = async (
  reminderId: number,
  lockId: string,
  error: unknown,
  actor?: AdminActor | null
) =>
  withTransaction(async (connection) => {
    await markReminderFailedInCurrentTransaction({ actor, error, lockId, reminderId }, connection);
  });

const lockDueReminders = async (limit?: number) => {
  const normalizedLimit = normalizeLimit(limit);
  const lockId = `reminder-${process.pid}-${Date.now()}-${randomUUID()}`;

  return withTransaction(async (connection) => {
    await executeStatement(
      `UPDATE event_reminders
       SET delivery_status_code = 'processing',
           locked_at = UTC_TIMESTAMP(6),
           locked_by = ?,
           failure_reason = NULL,
           next_attempt_at = NULL
       WHERE id IN (
         SELECT due.id
         FROM (
           SELECT er.id
           FROM event_reminders er
           INNER JOIN events evt ON evt.id = er.event_id
           WHERE er.sent_at IS NULL
             AND evt.status_code <> 'cancelled'
             AND evt.client_visible_flag = 1
             AND er.delivery_status_code IN ('pending', 'failed', 'processing')
             AND er.scheduled_at <= UTC_TIMESTAMP(6)
             AND (er.next_attempt_at IS NULL OR er.next_attempt_at <= UTC_TIMESTAMP(6))
             AND (er.locked_at IS NULL OR er.locked_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ${LOCK_TTL_MINUTES} MINUTE))
             AND er.retry_count < er.max_attempts
           ORDER BY
             CASE er.delivery_status_code WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
             er.scheduled_at ASC,
             er.id ASC
           LIMIT ${normalizedLimit}
         ) AS due
       )`,
      [lockId],
      connection
    );

    const rows = await queryRows<RowDataPacket & { id: number }>(
      `SELECT id
       FROM event_reminders
       WHERE locked_by = ?
         AND delivery_status_code = 'processing'
       ORDER BY scheduled_at ASC, id ASC`,
      [lockId],
      connection
    );

    return {
      lockId,
      reminderIds: rows.map((row) => Number(row.id)),
    };
  });
};

export const listReminderWorkspace = async (options: { limit?: number } = {}) => {
  const limit = normalizeLimit(options.limit ?? 50);
  const [metricsRows, reminderRows] = await Promise.all([
    queryRows<ReminderMetricRow>(
      `SELECT
         SUM(CASE WHEN delivery_status_code = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE
           WHEN delivery_status_code IN ('pending', 'failed')
            AND scheduled_at <= UTC_TIMESTAMP(6)
            AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP(6))
           THEN 1 ELSE 0 END) AS due,
         SUM(CASE WHEN delivery_status_code = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN delivery_status_code = 'processing' THEN 1 ELSE 0 END) AS processing,
         SUM(CASE
           WHEN delivery_status_code = 'sent'
            AND sent_at >= DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 7 DAY)
           THEN 1 ELSE 0 END) AS sentRecent
       FROM event_reminders`
    ),
    queryRows<ReminderListRow>(
      `SELECT
         er.id,
         er.event_id AS eventId,
         er.recipient_user_id AS recipientUserId,
         er.channel_code AS channelCode,
         er.scheduled_at AS scheduledAt,
         er.sent_at AS sentAt,
         er.delivery_status_code AS deliveryStatusCode,
         er.failure_reason AS failureReason,
         er.retry_count AS retryCount,
         er.max_attempts AS maxAttempts,
         er.next_attempt_at AS nextAttemptAt,
         er.locked_at AS lockedAt,
         er.locked_by AS lockedBy,
         er.processed_at AS processedAt,
         evt.public_id AS eventPublicId,
         evt.title AS eventTitle,
         evt.event_type_code AS eventTypeCode,
         evt.status_code AS eventStatusCode,
         evt.scheduled_start_at AS scheduledStartAt,
         evt.client_account_id AS clientAccountId,
         evt.matter_id AS matterId,
         evt.client_visible_flag AS visibleToClient,
         client.display_name AS clientName,
         recipient.display_name AS recipientName,
         recipient.email AS recipientEmail,
         recipient.phone AS recipientPhone
       FROM event_reminders er
       INNER JOIN events evt ON evt.id = er.event_id
       INNER JOIN users recipient ON recipient.id = er.recipient_user_id
       LEFT JOIN client_accounts client ON client.id = evt.client_account_id
       WHERE er.delivery_status_code IN ('pending', 'failed', 'processing')
          OR (
            er.delivery_status_code = 'sent'
            AND er.sent_at >= DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 7 DAY)
          )
       ORDER BY
         FIELD(er.delivery_status_code, 'failed', 'processing', 'pending', 'sent'),
         er.scheduled_at ASC,
         er.id ASC
       LIMIT ?`,
      [limit]
    ),
  ]);

  const metrics = metricsRows[0] || {
    due: 0,
    failed: 0,
    pending: 0,
    processing: 0,
    sentRecent: 0,
  };

  return {
    metrics: {
      due: Number(metrics.due || 0),
      failed: Number(metrics.failed || 0),
      pending: Number(metrics.pending || 0),
      processing: Number(metrics.processing || 0),
      sentRecent: Number(metrics.sentRecent || 0),
    },
    providerMode: providerMode(),
    reminders: reminderRows.map((row) => ({
      channelCode: row.channelCode,
      clientName: row.clientName || undefined,
      deliveryModeLabel: deliveryLabelFor(row.channelCode),
      eventId: row.eventPublicId,
      eventTitle: row.eventTitle,
      failureReason: row.failureReason || undefined,
      id: String(row.id),
      lockedAt: row.lockedAt ? toUiDateTime(row.lockedAt) : undefined,
      maxAttempts: Number(row.maxAttempts || 0),
      nextAttemptAt: row.nextAttemptAt ? toUiDateTime(row.nextAttemptAt) : undefined,
      recipientName: row.recipientName || row.recipientEmail || 'Client portal user',
      retryCount: Number(row.retryCount || 0),
      scheduledAt: toUiDateTime(row.scheduledAt),
      sentAt: row.sentAt ? toUiDateTime(row.sentAt) : undefined,
      status: row.deliveryStatusCode,
    })),
    status: 'ok' as const,
  };
};

export const processDueReminders = async (options: { limit?: number } = {}) => {
  const locked = await lockDueReminders(options.limit);
  const results = {
    alreadyNotified: 0,
    failed: 0,
    processed: 0,
    skipped: 0,
  };

  for (const reminderId of locked.reminderIds) {
    try {
      const result = await completeLockedReminder(reminderId, locked.lockId, null);

      if (result.status === 'skipped') {
        results.skipped += 1;
      } else if (result.status === 'failed') {
        results.failed += 1;
      } else if (result.status === 'already_notified') {
        results.alreadyNotified += 1;
        results.processed += 1;
      } else {
        results.processed += 1;
      }
    } catch (error) {
      results.failed += 1;
      await markReminderFailed(reminderId, locked.lockId, error, null);
    }
  }

  return {
    locked: locked.reminderIds.length,
    providerMode: providerMode(),
    status: 'processed' as const,
    ...results,
  };
};

export const retryReminder = async (actor: AdminActor, reminderId: number) => {
  const lockId = `manual-reminder-${actor.userId}-${Date.now()}-${randomUUID()}`;

  const initial = await withTransaction(async (connection) => {
    const rows = await queryRows<
      RowDataPacket & {
        deliveryStatusCode: ReminderStatus;
        eventId: number;
        eventStatusCode: string;
        id: number;
        retryCount: number;
      }
    >(
      `SELECT
         er.id,
         er.event_id AS eventId,
         er.delivery_status_code AS deliveryStatusCode,
         er.retry_count AS retryCount,
         evt.status_code AS eventStatusCode
       FROM event_reminders er
       INNER JOIN events evt ON evt.id = er.event_id
       WHERE er.id = ?
       LIMIT 1
       FOR UPDATE`,
      [reminderId],
      connection
    );
    const row = rows[0];

    if (!row) {
      throw notFound('reminder_not_found', 'Reminder not found.');
    }

    if (row.deliveryStatusCode === 'sent') {
      return { status: 'already_sent' as const };
    }

    if (row.deliveryStatusCode === 'cancelled' || row.eventStatusCode === 'cancelled') {
      throw badRequest('reminder_not_retryable', 'Cancelled reminders cannot be retried.');
    }

    await executeStatement(
      `UPDATE event_reminders
       SET delivery_status_code = 'processing',
           locked_at = UTC_TIMESTAMP(6),
           locked_by = ?,
           max_attempts = GREATEST(max_attempts, retry_count + 1),
           next_attempt_at = NULL,
           failure_reason = NULL
       WHERE id = ?`,
      [lockId, row.id],
      connection
    );

    await auditReminder(
      {
        actionCode: 'reminder.retried',
        actionLabel: 'Reminder retry requested',
        actor,
        changes: [
          { fieldName: 'delivery_status_code', oldValue: row.deliveryStatusCode, newValue: 'processing' },
        ],
        eventId: Number(row.eventId),
        sourceModule: 'admin_notifications',
        summaryNewValue: 'Manual retry requested from admin notifications.',
      },
      connection
    );

    return { status: 'locked' as const };
  });

  if (initial.status === 'already_sent') {
    return {
      providerMode: providerMode(),
      reminderId: String(reminderId),
      status: 'already_sent' as const,
    };
  }

  try {
    const result = await completeLockedReminder(reminderId, lockId, actor);
    return {
      providerMode: providerMode(),
      reminderId: String(reminderId),
      status:
        result.status === 'skipped'
          ? ('skipped' as const)
          : result.status === 'failed'
            ? ('failed' as const)
            : ('retried' as const),
    };
  } catch (error) {
    await markReminderFailed(reminderId, lockId, error, actor);
    throw error;
  }
};
