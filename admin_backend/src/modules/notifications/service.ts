import type { RowDataPacket } from 'mysql2/promise';
import { forbidden, notFound } from '../../lib/httpErrors.js';
import { executeStatement, queryRows } from '../../lib/mysql.js';
import { toUiDateTime } from '../../lib/viewModels.js';
import type { AdminActor } from '../auth/service.js';
import { buildPaginationMeta, normalizePagination } from '../shared.js';

type NotificationRow = RowDataPacket & {
  bodyText: string;
  clientName: string | null;
  createdAt: string;
  dismissedAt: string | null;
  documentMatterTitle: string | null;
  documentName: string | null;
  eventMatterTitle: string | null;
  eventTitle: string | null;
  id: string;
  invoiceMatterTitle: string | null;
  invoiceNumber: string | null;
  isRead: number;
  matterId: string | null;
  matterTitle: string | null;
  readAt: string | null;
  threadMatterTitle: string | null;
  threadSubject: string | null;
  title: string;
  typeCode: string;
};

const mapType = (typeCode: string) => {
  switch (typeCode) {
    case 'invoice_generated':
    case 'payment_reminder':
      return 'billing';
    case 'document_uploaded':
      return 'document';
    case 'event_reminder':
      return 'event';
    case 'matter_update':
      return 'matter';
    case 'message_received':
      return 'message';
    case 'proposal':
      return 'proposal';
    default:
      return 'system';
  }
};

const deriveMatterTitle = (row: NotificationRow) =>
  row.matterTitle ||
  row.invoiceMatterTitle ||
  row.threadMatterTitle ||
  row.eventMatterTitle ||
  row.documentMatterTitle ||
  undefined;

const deriveSource = (typeCode: string) => {
  switch (typeCode) {
    case 'invoice_generated':
    case 'payment_reminder':
      return 'Billing System';
    case 'document_uploaded':
      return 'Documents Desk';
    case 'event_reminder':
      return 'Calendar System';
    case 'matter_update':
      return 'Matter Desk';
    case 'message_received':
      return 'Messaging Desk';
    default:
      return 'Admin Backend';
  }
};

const getNotificationRecord = async (notificationId: string) => {
  const rows = await queryRows<RowDataPacket & { dbId: number; recipientUserId: number }>(
    `SELECT id AS dbId,
            recipient_user_id AS recipientUserId
     FROM notifications
     WHERE public_id = ?
     LIMIT 1`,
    [notificationId]
  );

  const row = rows[0];

  if (!row) {
    throw notFound('notification_not_found', 'Notification not found.');
  }

  return row;
};

const assertCanMutateNotification = (
  actor: AdminActor,
  notification: { recipientUserId: number }
) => {
  if (Number(notification.recipientUserId) === actor.userId) {
    return;
  }

  if (actor.permissionCodes.includes('notification.manage')) {
    return;
  }

  throw forbidden(
    'notification_recipient_forbidden',
    'You cannot update a notification assigned to another admin.'
  );
};

const notificationListScope = (actor: AdminActor) => {
  if (actor.permissionCodes.includes('notification.manage')) {
    return { params: [] as unknown[], sql: '' };
  }

  return {
    params: [actor.userId] as unknown[],
    sql: 'WHERE n.recipient_user_id = ?',
  };
};

export const listNotifications = async (
  actor: AdminActor,
  options: { limit?: number; offset?: number } = {}
) => {
  const pagination = normalizePagination(options);
  const scope = notificationListScope(actor);
  const totalRows = await queryRows<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total
     FROM notifications n
     ${scope.sql}`,
    scope.params
  );
  const rows = await queryRows<NotificationRow>(
    `SELECT
       n.public_id AS id,
       n.notification_type_code AS typeCode,
       n.title,
       n.body_text AS bodyText,
       n.created_at AS createdAt,
       n.is_read AS isRead,
       n.read_at AS readAt,
       n.dismissed_at AS dismissedAt,
       matter.public_id AS matterId,
       matter.title AS matterTitle,
       invoice.invoice_number AS invoiceNumber,
       invoice_matter.title AS invoiceMatterTitle,
       thread.subject AS threadSubject,
       thread_matter.title AS threadMatterTitle,
       evt.title AS eventTitle,
       event_matter.title AS eventMatterTitle,
       doc.title AS documentName,
       doc_matter.title AS documentMatterTitle,
       COALESCE(
         matter_client.display_name,
         invoice_client.display_name,
         thread_client.display_name,
         event_client.display_name,
         document_client.display_name
       ) AS clientName
     FROM notifications n
     LEFT JOIN matters matter ON matter.id = n.matter_id
     LEFT JOIN client_accounts matter_client ON matter_client.id = matter.client_account_id
     LEFT JOIN invoices invoice ON invoice.id = n.invoice_id
     LEFT JOIN matters invoice_matter ON invoice_matter.id = invoice.matter_id
     LEFT JOIN client_accounts invoice_client ON invoice_client.id = invoice.client_account_id
     LEFT JOIN conversation_threads thread ON thread.id = n.thread_id
     LEFT JOIN matters thread_matter ON thread_matter.id = thread.matter_id
     LEFT JOIN client_accounts thread_client ON thread_client.id = thread.client_account_id
     LEFT JOIN events evt ON evt.id = n.event_id
     LEFT JOIN matters event_matter ON event_matter.id = evt.matter_id
     LEFT JOIN client_accounts event_client ON event_client.id = evt.client_account_id
     LEFT JOIN documents doc ON doc.id = n.document_id
     LEFT JOIN matter_documents md ON md.document_id = doc.id
     LEFT JOIN matters doc_matter ON doc_matter.id = md.matter_id
     LEFT JOIN client_accounts document_client ON document_client.id = doc.owner_client_account_id
     ${scope.sql}
     ORDER BY n.created_at DESC
     LIMIT ? OFFSET ?`,
    [...scope.params, pagination.limit, pagination.offset]
  );

  return {
    notifications: rows.map((row) => ({
      body: row.bodyText,
      clientName: row.clientName || undefined,
      date: toUiDateTime(row.createdAt),
      dismissed: Boolean(row.dismissedAt),
      id: row.id,
      matterId: row.matterId || undefined,
      matterTitle: deriveMatterTitle(row),
      read: Boolean(row.isRead),
      source: deriveSource(row.typeCode),
      title: row.title,
      type: mapType(row.typeCode) as
        | 'billing'
        | 'document'
        | 'event'
        | 'matter'
        | 'message'
        | 'proposal'
        | 'system',
    })),
    pagination: buildPaginationMeta(pagination, Number(totalRows[0]?.total || 0)),
  };
};

export const markRead = async (actor: AdminActor, notificationId: string) => {
  const notification = await getNotificationRecord(notificationId);
  assertCanMutateNotification(actor, notification);

  await executeStatement(
    `UPDATE notifications
     SET is_read = 1,
         read_at = COALESCE(read_at, UTC_TIMESTAMP(6))
     WHERE id = ?`,
    [notification.dbId]
  );

  return { status: 'read' as const };
};

export const dismiss = async (actor: AdminActor, notificationId: string) => {
  const notification = await getNotificationRecord(notificationId);
  assertCanMutateNotification(actor, notification);

  await executeStatement(
    `UPDATE notifications
     SET dismissed_at = COALESCE(dismissed_at, UTC_TIMESTAMP(6))
     WHERE id = ?`,
    [notification.dbId]
  );

  return { status: 'dismissed' as const };
};
