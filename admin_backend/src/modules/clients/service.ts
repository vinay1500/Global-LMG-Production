import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createPublicId } from '../../lib/authCrypto.js';
import { allocateBusinessNumber } from '../../lib/businessSequences.js';
import { badRequest, notFound } from '../../lib/httpErrors.js';
import { executeStatement, queryRows, withTransaction } from '../../lib/mysql.js';
import type { AdminActor } from '../auth/service.js';
import {
  fetchClientAudit,
  fetchClientsForList,
  countClientsForList,
  fetchDocuments,
  fetchEvents,
  fetchInvoices,
  fetchMatters,
  fetchPayments,
  fetchThreads,
  buildPaginationMeta,
  normalizePagination,
} from '../shared.js';
import { createAuditEvent } from '../writeSupport.js';
import { mapLifecycle, toUiDate, toUiDateTime } from '../../lib/viewModels.js';
import { getPlatformDefaultTimezone } from '../settings/platformSettings.js';

type ClientRow = RowDataPacket & {
  accountStatusCode: string;
  email: string;
  id: string;
  joinedAt: string;
  lastActiveAt: string | null;
  lifecycleSource: string;
  name: string;
  owner: string | null;
  phone: string;
  region: string | null;
};

type ClientRequestRow = RowDataPacket & {
  clientEmail: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  consultationMode: string;
  createdAt: string;
  expertiseArea: string;
  id: string;
  issueSummary: string;
  matterId: string | null;
  matterNumber: string | null;
  ownerName: string | null;
  preferredEndAt: string | null;
  preferredStartAt: string | null;
  quoteTotalAmount: number;
  requestNumber: string;
  selectedServices: string | null;
  statusCode: string;
  statusLabel: string | null;
  title: string;
  urgencyCode: string;
  urgencyLabel: string | null;
};

type ClientNotificationRow = RowDataPacket & {
  bodyText: string;
  createdAt: string;
  dismissedAt: string | null;
  documentMatterTitle: string | null;
  documentName: string | null;
  eventMatterTitle: string | null;
  id: string;
  invoiceMatterTitle: string | null;
  isRead: number;
  matterId: string | null;
  matterTitle: string | null;
  threadMatterTitle: string | null;
  title: string;
  typeCode: string;
};

type ExistingUserRow = RowDataPacket & {
  actorTypeCode: string;
  clientAccountId: string | null;
  clientAccountPublicId: string | null;
  email: string;
  id: number;
  publicId: string;
};

type ExistingPhoneUserRow = RowDataPacket & {
  email: string;
  id: number;
};

type ClientCreateRow = RowDataPacket & {
  accountStatusCode: string;
  activeMatters: number;
  email: string;
  hasUnread: number;
  id: string;
  joinedAt: string;
  lastActiveAt: string | null;
  lifecycleSource: string;
  mattersCount: number;
  name: string;
  owner: string | null;
  phone: string;
  region: string | null;
  totalDue: number;
};

const splitName = (value: string) => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || value.trim();
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;

  return { firstName, lastName };
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizePhone = (value?: string) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const toMysqlDateTime = (date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');

const mapClientListRow = (row: ClientCreateRow) => ({
  activeMatters: Number(row.activeMatters || 0),
  avatar: '',
  email: row.email,
  hasUnread: Boolean(row.hasUnread),
  id: row.id,
  joinedAt: toUiDate(row.joinedAt),
  lastActiveAt: row.lastActiveAt ? toUiDate(row.lastActiveAt) : toUiDate(row.joinedAt),
  lifecycle: mapLifecycle(row.accountStatusCode, row.lifecycleSource),
  mattersCount: Number(row.mattersCount || 0),
  name: row.name,
  owner: row.owner || 'Unassigned',
  phone: row.phone,
  region: row.region || '',
  totalDue: Number(row.totalDue || 0),
});

const toIso = (value: string | null) => (value ? value.replace(' ', 'T') : undefined);

const toLabel = (value: string) =>
  value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const mapNotificationType = (typeCode: string) => {
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

const notificationSource = (typeCode: string) => {
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
    case 'proposal':
      return 'Package Studio';
    default:
      return 'Admin Backend';
  }
};

const fetchClientRequests = async (clientAccountId: string) => {
  const rows = await queryRows<ClientRequestRow>(
    `SELECT
       sr.public_id AS id,
       sr.request_number AS requestNumber,
       ca.public_id AS clientId,
       ca.display_name AS clientName,
       ca.primary_email AS clientEmail,
       ca.primary_phone AS clientPhone,
       sr.title,
       sr.issue_summary AS issueSummary,
       ld.domain_name AS expertiseArea,
       sr.status_code AS statusCode,
       rs.label AS statusLabel,
       sr.consultation_mode_code AS consultationMode,
       pur.urgency_code AS urgencyCode,
       pur.label AS urgencyLabel,
       sr.preferred_start_at AS preferredStartAt,
       sr.preferred_end_at AS preferredEndAt,
       sr.quote_total_amount AS quoteTotalAmount,
       sr.created_at AS createdAt,
       owner.display_name AS ownerName,
       matter.public_id AS matterId,
       matter.matter_number AS matterNumber,
       GROUP_CONCAT(services.service_code ORDER BY req_services.sort_order SEPARATOR ',') AS selectedServices
     FROM service_requests sr
     INNER JOIN client_accounts ca ON ca.id = sr.client_account_id
     INNER JOIN legal_domains ld ON ld.id = sr.legal_domain_id
     INNER JOIN pricing_urgency_rules pur ON pur.id = sr.urgency_rule_id
     LEFT JOIN request_statuses rs ON rs.code = sr.status_code
     LEFT JOIN users owner ON owner.id = ca.owner_user_id
     LEFT JOIN matters matter ON matter.service_request_id = sr.id AND matter.archived_at IS NULL
     LEFT JOIN request_services req_services ON req_services.service_request_id = sr.id
     LEFT JOIN services ON services.id = req_services.service_id
     WHERE sr.archived_at IS NULL
       AND ca.public_id = ?
       AND sr.status_code <> 'draft_payment_pending'
     GROUP BY
       sr.id,
       sr.public_id,
       sr.request_number,
       ca.public_id,
       ca.display_name,
       ca.primary_email,
       ca.primary_phone,
       sr.title,
       sr.issue_summary,
       ld.domain_name,
       sr.status_code,
       rs.label,
       sr.consultation_mode_code,
       pur.urgency_code,
       pur.label,
       sr.preferred_start_at,
       sr.preferred_end_at,
       sr.quote_total_amount,
       sr.created_at,
       owner.display_name,
       matter.public_id,
       matter.matter_number
     ORDER BY sr.created_at DESC`,
    [clientAccountId]
  );

  return rows.map((row) => ({
    clientEmail: row.clientEmail,
    clientId: row.clientId,
    clientName: row.clientName,
    clientPhone: row.clientPhone,
    consultationMode: row.consultationMode,
    createdAt: row.createdAt.replace(' ', 'T'),
    expertiseArea: row.expertiseArea,
    id: row.id,
    issueSummary: row.issueSummary,
    matterId: row.matterId || undefined,
    matterNumber: row.matterNumber || undefined,
    ownerName: row.ownerName || 'Intake Desk',
    preferredEndAt: toIso(row.preferredEndAt),
    preferredStartAt: toIso(row.preferredStartAt),
    quoteTotalAmount: Number(row.quoteTotalAmount || 0),
    requestNumber: row.requestNumber,
    selectedServices: row.selectedServices ? row.selectedServices.split(',').filter(Boolean) : [],
    statusCode: row.statusCode,
    statusLabel: row.statusLabel || toLabel(row.statusCode),
    title: row.title,
    urgencyCode: row.urgencyCode,
    urgencyLabel: row.urgencyLabel || toLabel(row.urgencyCode),
  }));
};

const fetchClientNotifications = async (clientAccountId: string) => {
  const rows = await queryRows<ClientNotificationRow>(
    `SELECT
       n.public_id AS id,
       n.notification_type_code AS typeCode,
       n.title,
       n.body_text AS bodyText,
       n.created_at AS createdAt,
       n.is_read AS isRead,
       n.dismissed_at AS dismissedAt,
       matter.public_id AS matterId,
       matter.title AS matterTitle,
       invoice_matter.title AS invoiceMatterTitle,
       thread_matter.title AS threadMatterTitle,
       event_matter.title AS eventMatterTitle,
       doc.title AS documentName,
       doc_matter.title AS documentMatterTitle
     FROM notifications n
     LEFT JOIN client_account_contacts recipient_contact
       ON recipient_contact.user_id = n.recipient_user_id
      AND recipient_contact.archived_at IS NULL
     LEFT JOIN client_accounts recipient_client ON recipient_client.id = recipient_contact.client_account_id
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
     WHERE COALESCE(
       recipient_client.public_id,
       matter_client.public_id,
       invoice_client.public_id,
       thread_client.public_id,
       event_client.public_id,
       document_client.public_id
     ) = ?
     ORDER BY n.created_at DESC
     LIMIT 25`,
    [clientAccountId]
  );

  return rows.map((row) => ({
    body: row.bodyText,
    clientId: clientAccountId,
    date: toUiDateTime(row.createdAt),
    dismissed: Boolean(row.dismissedAt),
    id: row.id,
    matterId: row.matterId || undefined,
    matterTitle:
      row.matterTitle ||
      row.invoiceMatterTitle ||
      row.threadMatterTitle ||
      row.eventMatterTitle ||
      row.documentMatterTitle ||
      undefined,
    read: Boolean(row.isRead),
    source: notificationSource(row.typeCode),
    title: row.title,
    type: mapNotificationType(row.typeCode),
  }));
};

export const listClients = async (options: { limit: number; offset: number; search?: string }) => {
  const pagination = normalizePagination(options);
  const [clients, total] = await Promise.all([
    fetchClientsForList({ ...pagination, search: options.search }),
    countClientsForList({ search: options.search }),
  ]);

  return {
    clients,
    pagination: buildPaginationMeta(pagination, total),
  };
};

const fetchClientListItemByPublicId = async (clientAccountPublicId: string) => {
  const rows = await queryRows<ClientCreateRow>(
    `SELECT
       ca.public_id AS id,
       ca.display_name AS name,
       ca.primary_email AS email,
       ca.primary_phone AS phone,
       ca.onboarding_status_code AS lifecycleSource,
       ca.account_status_code AS accountStatusCode,
       ca.created_at AS joinedAt,
       COALESCE(contact.last_login_at, ca.updated_at) AS lastActiveAt,
       owner.display_name AS owner,
       addr.city AS region,
       COALESCE(mstats.activeMatters, 0) AS activeMatters,
       COALESCE(mstats.mattersCount, 0) AS mattersCount,
       COALESCE(istats.totalDue, 0) AS totalDue,
       CASE WHEN COALESCE(tstats.waitingThreads, 0) > 0 THEN 1 ELSE 0 END AS hasUnread
     FROM client_accounts ca
     LEFT JOIN users owner ON owner.id = ca.owner_user_id
     LEFT JOIN client_account_contacts cac
       ON cac.client_account_id = ca.id
      AND cac.is_primary = 1
      AND cac.archived_at IS NULL
     LEFT JOIN users contact ON contact.id = cac.user_id
     LEFT JOIN client_addresses addr
       ON addr.client_account_id = ca.id
      AND addr.is_primary = 1
      AND addr.archived_at IS NULL
     LEFT JOIN (
       SELECT
         client_account_id,
         COUNT(*) AS mattersCount,
         SUM(CASE WHEN operational_status_code NOT IN ('completed', 'archived') THEN 1 ELSE 0 END) AS activeMatters
       FROM matters
       WHERE archived_at IS NULL
       GROUP BY client_account_id
     ) AS mstats ON mstats.client_account_id = ca.id
     LEFT JOIN (
       SELECT client_account_id, SUM(amount_due) AS totalDue
       FROM invoices
       WHERE archived_at IS NULL
       GROUP BY client_account_id
     ) AS istats ON istats.client_account_id = ca.id
     LEFT JOIN (
       SELECT client_account_id, COUNT(*) AS waitingThreads
       FROM conversation_threads
       WHERE archived_at IS NULL AND status_code = 'waiting'
       GROUP BY client_account_id
     ) AS tstats ON tstats.client_account_id = ca.id
     WHERE ca.public_id = ?
       AND ca.archived_at IS NULL
     LIMIT 1`,
    [clientAccountPublicId]
  );

  const row = rows[0];
  if (!row) {
    throw notFound('client_not_found', 'Client account not found.');
  }

  return mapClientListRow(row);
};

export const createClient = async (
  actor: AdminActor,
  payload: {
    city?: string;
    clientType?: 'business' | 'individual' | 'organization';
    displayName: string;
    email: string;
    notes?: string;
    phone?: string;
    portalAccessEnabled?: boolean;
    primaryContactName: string;
    state?: string;
  }
) => {
  const normalizedEmail = normalizeEmail(payload.email);
  const normalizedPhone = normalizePhone(payload.phone);
  const displayName = payload.displayName.trim();
  const primaryContactName = payload.primaryContactName.trim() || displayName;
  const portalAccessEnabled = payload.portalAccessEnabled ?? true;
  const timestamp = toMysqlDateTime();

  const clientAccountPublicId = await withTransaction(async (connection) => {
    const existingUsers = await queryRows<ExistingUserRow>(
      `SELECT
         u.id,
         u.public_id AS publicId,
         u.email,
         u.actor_type_code AS actorTypeCode,
         ca.id AS clientAccountId,
         ca.public_id AS clientAccountPublicId
       FROM users u
       LEFT JOIN client_account_contacts cac
         ON cac.user_id = u.id
        AND cac.archived_at IS NULL
       LEFT JOIN client_accounts ca
         ON ca.id = cac.client_account_id
        AND ca.archived_at IS NULL
       WHERE LOWER(u.email) = ?
         AND u.archived_at IS NULL
       LIMIT 1
       FOR UPDATE`,
      [normalizedEmail],
      connection
    );
    const existingUser = existingUsers[0] || null;

    if (normalizedPhone) {
      const existingPhoneUsers = await queryRows<ExistingPhoneUserRow>(
        `SELECT id, email
         FROM users
         WHERE phone = ?
           AND archived_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [normalizedPhone],
        connection
      );
      const existingPhoneUser = existingPhoneUsers[0] || null;

      if (existingPhoneUser && existingPhoneUser.id !== existingUser?.id) {
        throw badRequest(
          'client_phone_already_exists',
          'This phone number is already linked to another user. Use a different phone number or open the existing record.'
        );
      }
    }

    if (existingUser?.clientAccountPublicId) {
      throw badRequest(
        'client_email_already_exists',
        'A client account already exists for this email. Open that client instead of creating a duplicate.'
      );
    }

    if (existingUser && existingUser.actorTypeCode !== 'client') {
      throw badRequest(
        'client_email_reserved',
        'This email is already used by an internal/admin user and cannot be reused for a client account.'
      );
    }

    let userId = existingUser?.id || null;
    if (!userId) {
      const { firstName, lastName } = splitName(primaryContactName);
      const timezoneName = await getPlatformDefaultTimezone(connection);
      const userResult = await executeStatement<ResultSetHeader>(
        `INSERT INTO users (
           public_id,
           email,
           phone,
           display_name,
           first_name,
           last_name,
           actor_type_code,
           account_status_code,
           timezone_name,
           locale_code,
           avatar_url,
           login_enabled,
           last_login_at,
           email_verified_at,
           phone_verified_at,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'client', 'active', ?, 'en-US', '', ?, NULL, NULL, NULL, ?, ?)`,
        [
          createPublicId(),
          normalizedEmail,
          normalizedPhone,
          primaryContactName,
          firstName,
          lastName,
          timezoneName,
          portalAccessEnabled ? 1 : 0,
          timestamp,
          timestamp,
        ],
        connection
      );
      userId = userResult.insertId;
    } else {
      await executeStatement(
        `UPDATE users
         SET phone = COALESCE(?, phone),
             display_name = COALESCE(NULLIF(?, ''), display_name),
             login_enabled = CASE WHEN ? = 1 THEN 1 ELSE login_enabled END,
             updated_at = ?
         WHERE id = ?`,
        [normalizedPhone, primaryContactName, portalAccessEnabled ? 1 : 0, timestamp, userId],
        connection
      );
    }

    const clientCode = await allocateBusinessNumber(connection, 'client_account', 'CLT');
    const clientPublicId = createPublicId();
    const clientResult = await executeStatement<ResultSetHeader>(
      `INSERT INTO client_accounts (
         public_id,
         client_code,
         client_type_code,
         legal_name,
         display_name,
         billing_name,
         primary_email,
         primary_phone,
         gstin,
         tax_identifier,
         onboarding_status_code,
         account_status_code,
         owner_user_id,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'registered', 'active', ?, ?, ?)`,
      [
        clientPublicId,
        clientCode,
        payload.clientType || 'individual',
        displayName,
        displayName,
        displayName,
        normalizedEmail,
        normalizedPhone || '',
        actor.userId,
        timestamp,
        timestamp,
      ],
      connection
    );
    const clientAccountId = clientResult.insertId;

    await executeStatement(
      `INSERT INTO client_account_contacts (
         client_account_id,
         user_id,
         contact_role_code,
         is_primary,
         is_billing,
         portal_access_enabled,
         created_at,
         updated_at
       ) VALUES (?, ?, 'primary', 1, 1, ?, ?, ?)`,
      [clientAccountId, userId, portalAccessEnabled ? 1 : 0, timestamp, timestamp],
      connection
    );

    await executeStatement(
      `INSERT INTO client_addresses (
         client_account_id,
         address_type_code,
         line1,
         line2,
         city,
         state,
         postal_code,
         country_code,
         is_primary,
         created_at,
         updated_at
       ) VALUES (?, 'primary', 'Address pending', NULL, ?, ?, '000000', 'IN', 1, ?, ?)`,
      [
        clientAccountId,
        payload.city?.trim() || 'Not provided',
        payload.state?.trim() || 'Not provided',
        timestamp,
        timestamp,
      ],
      connection
    );

    await executeStatement(
      `INSERT INTO user_notification_preferences (
         user_id,
         email_updates,
         sms_alerts,
         invoice_reminders,
         case_activity_alerts,
         product_announcements,
         updated_at
       ) VALUES (?, 1, 1, 1, 1, 0, ?)
       ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
      [userId, timestamp],
      connection
    );

    await executeStatement(
      `INSERT IGNORE INTO user_roles (
         user_id,
         role_code,
         granted_by_user_id,
         starts_at,
         ends_at,
         is_active,
         created_at,
         updated_at
       ) VALUES (?, 'client', ?, ?, NULL, 1, ?, ?)`,
      [userId, actor.userId, timestamp, timestamp, timestamp],
      connection
    );

    await createAuditEvent(
      {
        actionCode: 'client.created',
        actionLabel: 'Client created',
        actorRoleCode: actor.roleCodes[0] || 'ops_admin',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'display_name', newValue: displayName },
          { fieldName: 'primary_email', newValue: normalizedEmail },
          { fieldName: 'portal_access_enabled', newValue: portalAccessEnabled },
          { fieldName: 'notes', newValue: payload.notes?.trim() || null },
        ],
        entityPk: clientAccountId,
        entityTableName: 'client_accounts',
        sourceModule: 'client_directory',
        summaryNewValue: {
          clientCode,
          clientId: clientPublicId,
          inviteDelivery: 'manual_not_sent',
        },
      },
      connection
    );

    return clientPublicId;
  });

  return {
    client: await fetchClientListItemByPublicId(clientAccountPublicId),
    portalInvite: {
      mode: 'manual',
      status: 'not_sent',
    },
    status: 'created' as const,
  };
};

export const getClientWorkspace = async (clientAccountId: string) => {
  const rows = await queryRows<ClientRow>(
    `SELECT
       ca.public_id AS id,
       ca.display_name AS name,
       ca.primary_email AS email,
       ca.primary_phone AS phone,
       ca.onboarding_status_code AS lifecycleSource,
       ca.account_status_code AS accountStatusCode,
       ca.created_at AS joinedAt,
       COALESCE(contact.last_login_at, ca.updated_at) AS lastActiveAt,
       owner.display_name AS owner,
       addr.city AS region
     FROM client_accounts ca
     LEFT JOIN users owner ON owner.id = ca.owner_user_id
     LEFT JOIN client_account_contacts cac
       ON cac.client_account_id = ca.id
      AND cac.is_primary = 1
      AND cac.archived_at IS NULL
     LEFT JOIN users contact ON contact.id = cac.user_id
     LEFT JOIN client_addresses addr
       ON addr.client_account_id = ca.id
      AND addr.is_primary = 1
      AND addr.archived_at IS NULL
     WHERE ca.public_id = ?
       AND ca.archived_at IS NULL
     LIMIT 1`,
    [clientAccountId]
  );

  const clientRow = rows[0];

  if (!clientRow) {
    throw notFound('client_not_found', 'Client account not found.');
  }

  const [requests, matters, invoices, payments, documents, events, threads, notifications] =
    await Promise.all([
      fetchClientRequests(clientAccountId),
      fetchMatters({ clientAccountIds: [clientAccountId] }),
      fetchInvoices({ clientAccountIds: [clientAccountId] }),
      fetchPayments({ clientAccountIds: [clientAccountId] }),
      fetchDocuments({ clientAccountIds: [clientAccountId] }),
      fetchEvents({ clientAccountIds: [clientAccountId], includeCancelled: true }),
      fetchThreads({ clientAccountIds: [clientAccountId] }),
      fetchClientNotifications(clientAccountId),
    ]);
  const auditEntries = await fetchClientAudit(matters.map((matter) => matter.id));
  const totalBilled = invoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0);
  const totalPaid = payments
    .filter((payment) => payment.status === 'success')
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  return {
    auditEntries,
    client: {
      avatar: '',
      email: clientRow.email,
      id: clientRow.id,
      joinedAt: toUiDate(clientRow.joinedAt),
      lastActiveAt: clientRow.lastActiveAt ? toUiDate(clientRow.lastActiveAt) : toUiDate(clientRow.joinedAt),
      lifecycle: mapLifecycle(clientRow.accountStatusCode, clientRow.lifecycleSource),
      name: clientRow.name,
      owner: clientRow.owner || 'Unassigned',
      phone: clientRow.phone,
      region: clientRow.region || '',
    },
    documents,
    events,
    invoices,
    matters,
    notifications,
    payments,
    requests,
    summary: {
      activeMatterCount: matters.filter((matter) => matter.operationalStatus !== 'completed').length,
      documentCount: documents.length,
      eventCount: events.length,
      invoiceCount: invoices.length,
      matterCount: matters.length,
      notificationCount: notifications.length,
      outstandingBalance: Math.max(totalBilled - totalPaid, 0),
      paymentCount: payments.length,
      requestCount: requests.length,
      threadCount: threads.length,
      totalBilled,
      totalPaid,
      unreadThreadCount: threads.filter((thread) => thread.unreadCount > 0).length,
    },
    threads,
  };
};
