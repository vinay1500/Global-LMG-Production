import type { RowDataPacket } from 'mysql2/promise';
import { queryRows } from '../lib/mysql.js';
import {
  buildMatterStages,
  mapLifecycle,
  mapMatterPriority,
  mapReviewState,
  mapVisibility,
  toUiDate,
  toUiDateTime,
  toUiTime,
} from '../lib/viewModels.js';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export type PaginationOptions = {
  limit?: number;
  offset?: number;
};

export type PaginationMeta = {
  hasMore: boolean;
  limit: number;
  offset: number;
  total: number;
};

export const normalizePagination = (options: PaginationOptions = {}) => {
  const parsedLimit = Number(options.limit);
  const parsedOffset = Number(options.offset);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(Math.trunc(parsedLimit), MAX_LIST_LIMIT))
    : DEFAULT_LIST_LIMIT;
  const offset = Number.isFinite(parsedOffset) ? Math.max(0, Math.trunc(parsedOffset)) : 0;

  return { limit, offset };
};

export const buildPaginationMeta = (
  pagination: ReturnType<typeof normalizePagination>,
  total: number
): PaginationMeta => ({
  hasMore: pagination.offset + pagination.limit < total,
  limit: pagination.limit,
  offset: pagination.offset,
  total,
});

type MatterRow = RowDataPacket & {
  assignedCounsel: string | null;
  assignedStaff: string | null;
  clientId: string;
  clientName: string;
  consultationMode: string;
  createdAt: string;
  dbId: number;
  dueAmount: number;
  expertiseArea: string;
  id: string;
  issueSummary: string;
  lastUpdated: string;
  lifecycleStage: string;
  matterNumber: string;
  meetingLink: string | null;
  operationalStatus: string;
  paidAmount: number;
  totalFee: number;
  title: string;
  urgency: string;
};

type MatterOptionRow = RowDataPacket & {
  clientId: string;
  clientName: string;
  consultationMode: string | null;
  createdAt: string;
  dueAmount: number | null;
  expertiseArea: string | null;
  id: string;
  issueSummary: string | null;
  lastUpdated: string;
  lifecycleStage: string | null;
  matterNumber: string;
  operationalStatus: string | null;
  paidAmount: number | null;
  title: string;
  totalFee: number | null;
  urgency: string | null;
};

type ServiceRow = RowDataPacket & { dbId: number; serviceCode: string };
type UpdateRow = RowDataPacket & { bodyText: string; dbId: number; visibleToClient: number };
type MatterAssignmentSummaryRow = RowDataPacket & {
  dbId: number;
  id: string;
  name: string;
  type: 'external_counsel' | 'field_partner' | 'internal_staff';
  visibleToClient: number;
};

type InvoiceRow = RowDataPacket & {
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingCountryCode: string | null;
  billingEmail: string | null;
  billingGstin: string | null;
  billingName: string | null;
  billingPhone: string | null;
  billingPostalCode: string | null;
  billingState: string | null;
  businessAddress: string | null;
  businessEmail: string | null;
  businessGstin: string | null;
  businessName: string | null;
  businessPaymentInstructions: string | null;
  businessPhone: string | null;
  businessState: string | null;
  businessWebsite: string | null;
  clientId: string;
  clientName: string;
  currencyCode: string;
  dbId: number;
  discount: number;
  dueDate: string;
  id: string;
  issueDate: string;
  matterId: string | null;
  matterRef: string | null;
  matterTitle: string | null;
  paidDate: string | null;
  renderedBody: string | null;
  renderedFooter: string | null;
  renderedSubject: string | null;
  renderedTerms: string | null;
  status: string;
  subtotal: number;
  tax: number;
  templateId: string | null;
  templateVersion: number | null;
  totalAmount: number;
};

type InvoiceLineRow = RowDataPacket & {
  amount: number;
  description: string;
  invoiceLineDbId: number;
  invoiceDbId: number;
  quantity: number;
  rate: number;
};

type InvoiceLineTaxRow = RowDataPacket & {
  amount: number;
  code: string;
  invoiceLineDbId: number;
  name: string;
  percent: number;
  taxableAmount: number;
};

type InvoiceSummaryRow = RowDataPacket & {
  clientId: string;
  clientName: string;
  currencyCode: string;
  discount: number;
  dueDate: string;
  id: string;
  issueDate: string;
  matterId: string | null;
  matterRef: string | null;
  matterTitle: string | null;
  status: string;
  subtotal: number;
  tax: number;
  totalAmount: number;
};

type DocumentRow = RowDataPacket & {
  clientId: string;
  clientName: string;
  docCategory: string;
  id: string;
  matterId: string | null;
  matterTitle: string | null;
  name: string;
  note: string | null;
  reviewStateSource: string;
  size: number;
  type: string;
  uploadedAt: string;
  uploadedBy: string;
  visibilityScope: string;
  virusStatus: string;
};

type EventRow = RowDataPacket & {
  calendarSyncError: string | null;
  calendarSyncStatus: 'cancelled' | 'disabled' | 'failed' | 'local' | 'pending' | 'synced';
  calendarSyncedAt: string | null;
  calendarOwnerEmail: string | null;
  clientId: string;
  clientName: string;
  googleAttendeeStatus: string;
  dateSource: string;
  duration: number;
  id: string;
  joinUrl: string | null;
  location: string | null;
  matterId: string | null;
  matterTitle: string | null;
  meetConferenceId: string | null;
  mode: string;
  notes: string | null;
  reminderCount: number;
  reminderStatus: 'cancelled' | 'none' | 'scheduled';
  status: string;
  title: string;
  type: string;
  visibleToClient: number;
};

type ThreadRow = RowDataPacket & {
  assignedTo: string | null;
  clientId: string;
  clientName: string;
  id: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  matterId: string | null;
  matterRef: string | null;
  matterTitle: string | null;
  stage: string | null;
  status: string;
  subject: string | null;
  unreadCount: number;
  urgency: string | null;
};

type MessageRow = RowDataPacket & {
  attachmentRefs: string | null;
  content: string;
  id: string;
  senderId: string | null;
  senderName: string | null;
  senderRole: 'admin' | 'client' | 'system';
  threadId: string;
  timestamp: string;
};

type PaymentRow = RowDataPacket & {
  amount: number;
  clientId: string;
  clientName: string;
  id: string;
  invoiceId: string | null;
  matterId: string | null;
  method: 'bank-transfer' | 'cash' | 'cheque' | 'online';
  recordedBy: string | null;
  reference: string | null;
  status: 'failed' | 'refunded' | 'success';
  timestamp: string;
};

type ClientOptionRow = RowDataPacket & {
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

type AuditRow = RowDataPacket & {
  action: string;
  actor: string | null;
  actorRole: string;
  entityId: string;
  entityType: string;
  id: string;
  sourceModule: string;
  timestamp: string;
};

const AUTOMATIC_REQUEST_ACKNOWLEDGEMENT =
  'We have received your request. A case manager will confirm the next step shortly.';

const buildInClause = (values: readonly unknown[]) => values.map(() => '?').join(', ');

const parseAttachmentRefs = (value: string | null | undefined) =>
  value
    ? value
        .split('\u001E')
        .map((entry) => {
          const [documentId, name] = entry.split('\u001F');
          return documentId && name ? { documentId, name } : null;
        })
        .filter((entry): entry is { documentId: string; name: string } => Boolean(entry))
    : undefined;

export const fetchMatters = async (filters: {
  clientAccountIds?: string[];
  limit?: number;
  matterIds?: string[];
  offset?: number;
  search?: string;
}) => {
  const where: string[] = ['m.archived_at IS NULL'];
  const params: unknown[] = [];

  if (filters.clientAccountIds?.length) {
    where.push(`ca.public_id IN (${buildInClause(filters.clientAccountIds)})`);
    params.push(...filters.clientAccountIds);
  }

  if (filters.matterIds?.length) {
    where.push(`m.public_id IN (${buildInClause(filters.matterIds)})`);
    params.push(...filters.matterIds);
  }

  if (filters.search) {
    where.push('(m.title LIKE ? OR m.matter_number LIKE ? OR ca.display_name LIKE ?)');
    const searchValue = `%${filters.search}%`;
    params.push(searchValue, searchValue, searchValue);
  }

  let sql = `
    SELECT
      m.id AS dbId,
      m.public_id AS id,
      ca.public_id AS clientId,
      ca.display_name AS clientName,
      m.title,
      m.matter_number AS matterNumber,
      m.current_stage_code AS lifecycleStage,
      m.operational_status_code AS operationalStatus,
      ld.domain_name AS expertiseArea,
      m.issue_summary AS issueSummary,
      pur.urgency_code AS urgency,
      m.consultation_mode_code AS consultationMode,
      m.quoted_total_amount AS totalFee,
      m.paid_total_amount AS paidAmount,
      m.due_total_amount AS dueAmount,
      m.opened_at AS createdAt,
      m.last_activity_at AS lastUpdated,
      GROUP_CONCAT(DISTINCT CASE WHEN cp.id IS NOT NULL AND COALESCE(cp.partner_type_code, 'external_counsel') = 'external_counsel' THEN cp.full_name END ORDER BY cp.full_name SEPARATOR ', ') AS assignedCounsel,
      GROUP_CONCAT(DISTINCT CASE WHEN cp.id IS NOT NULL AND COALESCE(cp.partner_type_code, 'external_counsel') = 'field_partner' THEN cp.full_name END ORDER BY cp.full_name SEPARATOR ', ') AS assignedFieldPartners,
      GROUP_CONCAT(DISTINCT CASE WHEN iu.id IS NOT NULL THEN iu.display_name END ORDER BY iu.display_name SEPARATOR ', ') AS assignedStaff,
      MAX(CASE WHEN e.join_url IS NOT NULL AND e.status_code = 'upcoming' THEN e.join_url END) AS meetingLink
    FROM matters m
    JOIN client_accounts ca ON ca.id = m.client_account_id
    JOIN legal_domains ld ON ld.id = m.legal_domain_id
    JOIN pricing_urgency_rules pur ON pur.id = m.urgency_rule_id
    LEFT JOIN matter_assignments ma ON ma.matter_id = m.id AND ma.removed_at IS NULL
    LEFT JOIN counsel_partners cp ON cp.id = ma.counsel_partner_id
    LEFT JOIN users iu ON iu.id = ma.internal_user_id
    LEFT JOIN events e ON e.matter_id = m.id AND e.cancelled_at IS NULL
    WHERE ${where.join(' AND ')}
    GROUP BY
      m.id, m.public_id, ca.public_id, ca.display_name, m.title, m.matter_number,
      m.current_stage_code, m.operational_status_code, ld.domain_name, m.issue_summary,
      pur.urgency_code, m.consultation_mode_code, m.quoted_total_amount, m.paid_total_amount,
      m.due_total_amount, m.opened_at, m.last_activity_at
    ORDER BY m.last_activity_at DESC`;

  if (filters.limit) {
    sql += ' LIMIT ? OFFSET ?';
    params.push(filters.limit, filters.offset ?? 0);
  }

  const matterRows = await queryRows<MatterRow>(sql, params);

  if (matterRows.length === 0) {
    return [];
  }

  const dbIds = matterRows.map((row) => row.dbId);
  const serviceRows = await queryRows<ServiceRow>(
    `SELECT ms.matter_id AS dbId, s.service_code AS serviceCode
     FROM matter_services ms
     JOIN services s ON s.id = ms.service_id
     WHERE ms.matter_id IN (${buildInClause(dbIds)})`,
    dbIds
  );
  const updateRows = await queryRows<UpdateRow>(
    `SELECT matter_id AS dbId, body_text AS bodyText, visible_to_client AS visibleToClient
     FROM matter_updates
     WHERE matter_id IN (${buildInClause(dbIds)})
     ORDER BY created_at DESC`,
    dbIds
  );
  const assignmentRows = await queryRows<MatterAssignmentSummaryRow>(
    `SELECT
       ma.matter_id AS dbId,
       COALESCE(u.public_id, cp.public_id) AS id,
       COALESCE(u.display_name, cp.full_name) AS name,
       CASE
         WHEN u.id IS NOT NULL THEN 'internal_staff'
         WHEN COALESCE(cp.partner_type_code, 'external_counsel') = 'field_partner' THEN 'field_partner'
         ELSE 'external_counsel'
       END AS type,
       COALESCE(ma.visible_to_client, 1) AS visibleToClient
     FROM matter_assignments ma
     LEFT JOIN users u ON u.id = ma.internal_user_id
     LEFT JOIN counsel_partners cp ON cp.id = ma.counsel_partner_id
     WHERE ma.matter_id IN (${buildInClause(dbIds)})
       AND ma.assignment_status_code = 'active'
       AND ma.removed_at IS NULL
     ORDER BY ma.assigned_at ASC, ma.id ASC`,
    dbIds
  );

  const servicesByMatterId = serviceRows.reduce<Record<number, string[]>>((accumulator, row) => {
    accumulator[row.dbId] = accumulator[row.dbId] || [];
    accumulator[row.dbId]!.push(row.serviceCode);
    return accumulator;
  }, {});

  const updatesByMatterId = updateRows.reduce<
    Record<number, { clientVisibleNotes: string[]; internalNotes: string[] }>
  >((accumulator, row) => {
    accumulator[row.dbId] =
      accumulator[row.dbId] || { clientVisibleNotes: [], internalNotes: [] };

    if (row.visibleToClient) {
      accumulator[row.dbId]!.clientVisibleNotes.push(row.bodyText);
    } else {
      accumulator[row.dbId]!.internalNotes.push(row.bodyText);
    }

    return accumulator;
  }, {});
  const assignmentsByMatterId = assignmentRows.reduce<Record<number, MatterAssignmentSummaryRow[]>>(
    (accumulator, row) => {
      if (!row.id || !row.name) {
        return accumulator;
      }
      accumulator[row.dbId] = accumulator[row.dbId] || [];
      accumulator[row.dbId]!.push(row);
      return accumulator;
    },
    {}
  );

  return matterRows.map((row) => ({
    assignedCounsel: row.assignedCounsel || undefined,
    assignedStaff: row.assignedStaff || undefined,
    assignments: (assignmentsByMatterId[row.dbId] || []).map((assignment) => ({
      id: assignment.id,
      name: assignment.name,
      type: assignment.type,
      visibleToClient: Boolean(assignment.visibleToClient),
    })),
    clientId: row.clientId,
    clientName: row.clientName,
    clientVisibleNotes: updatesByMatterId[row.dbId]?.clientVisibleNotes || [],
    consultationMode: row.consultationMode,
    createdAt: toUiDate(row.createdAt),
    dueAmount: row.dueAmount,
    expertiseArea: row.expertiseArea,
    id: row.id,
    internalNotes: updatesByMatterId[row.dbId]?.internalNotes || [],
    issueSummary: row.issueSummary,
    lastUpdated: toUiDate(row.lastUpdated),
    lifecycleStage: row.lifecycleStage,
    meetingLink: row.meetingLink || undefined,
    operationalStatus: row.operationalStatus,
    paidAmount: row.paidAmount,
    priority: mapMatterPriority(row.operationalStatus, row.urgency),
    referenceCode: row.matterNumber,
    selectedServices: servicesByMatterId[row.dbId] || [],
    stages: buildMatterStages(row.lifecycleStage),
    title: row.title,
    totalFee: row.totalFee,
    urgency: row.urgency,
  }));
};

export const fetchMatterOptions = async (filters: {
  clientAccountIds?: string[];
  limit?: number;
  offset?: number;
} = {}) => {
  const where: string[] = ['m.archived_at IS NULL'];
  const params: unknown[] = [];

  if (filters.clientAccountIds?.length) {
    where.push(`ca.public_id IN (${buildInClause(filters.clientAccountIds)})`);
    params.push(...filters.clientAccountIds);
  }

  const rows = await queryRows<MatterOptionRow>(
    `SELECT
       m.public_id AS id,
       ca.public_id AS clientId,
       ca.display_name AS clientName,
       m.title,
       m.matter_number AS matterNumber,
       m.current_stage_code AS lifecycleStage,
       m.operational_status_code AS operationalStatus,
       ld.domain_name AS expertiseArea,
       m.issue_summary AS issueSummary,
       pur.urgency_code AS urgency,
       m.consultation_mode_code AS consultationMode,
       m.quoted_total_amount AS totalFee,
       m.paid_total_amount AS paidAmount,
       m.due_total_amount AS dueAmount,
       m.opened_at AS createdAt,
       m.last_activity_at AS lastUpdated
     FROM matters m
     JOIN client_accounts ca ON ca.id = m.client_account_id
     LEFT JOIN legal_domains ld ON ld.id = m.legal_domain_id
     LEFT JOIN pricing_urgency_rules pur ON pur.id = m.urgency_rule_id
     WHERE ${where.join(' AND ')}
     ORDER BY m.last_activity_at DESC
     ${filters.limit ? 'LIMIT ? OFFSET ?' : ''}`,
    filters.limit ? [...params, filters.limit, filters.offset ?? 0] : params
  );

  return rows.map((row) => {
    const lifecycleStage = row.lifecycleStage || 'request-received';
    const urgency = row.urgency || 'standard';

    return {
      assignedCounsel: undefined,
      assignedStaff: undefined,
      assignments: [],
      clientId: row.clientId,
      clientName: row.clientName,
      clientVisibleNotes: [],
      consultationMode: row.consultationMode || 'video',
      createdAt: toUiDate(row.createdAt),
      dueAmount: Number(row.dueAmount || 0),
      expertiseArea: row.expertiseArea || '',
      id: row.id,
      internalNotes: [],
      issueSummary: row.issueSummary || '',
      lastUpdated: toUiDate(row.lastUpdated),
      lifecycleStage,
      meetingLink: undefined,
      operationalStatus: row.operationalStatus || 'open',
      paidAmount: Number(row.paidAmount || 0),
      priority: mapMatterPriority(row.operationalStatus || 'open', urgency),
      referenceCode: row.matterNumber,
      selectedServices: [],
      stages: buildMatterStages(lifecycleStage),
      title: row.title,
      totalFee: Number(row.totalFee || 0),
      urgency,
    };
  });
};

export const countMatters = async (filters: {
  clientAccountIds?: string[];
  matterIds?: string[];
  search?: string;
}) => {
  const where: string[] = ['m.archived_at IS NULL'];
  const params: unknown[] = [];

  if (filters.clientAccountIds?.length) {
    where.push(`ca.public_id IN (${buildInClause(filters.clientAccountIds)})`);
    params.push(...filters.clientAccountIds);
  }

  if (filters.matterIds?.length) {
    where.push(`m.public_id IN (${buildInClause(filters.matterIds)})`);
    params.push(...filters.matterIds);
  }

  if (filters.search) {
    where.push('(m.title LIKE ? OR m.matter_number LIKE ? OR ca.display_name LIKE ?)');
    const searchValue = `%${filters.search}%`;
    params.push(searchValue, searchValue, searchValue);
  }

  const rows = await queryRows<RowDataPacket & { total: number }>(
    `SELECT COUNT(DISTINCT m.id) AS total
     FROM matters m
     JOIN client_accounts ca ON ca.id = m.client_account_id
     WHERE ${where.join(' AND ')}`,
    params
  );

  return Number(rows[0]?.total || 0);
};

export const fetchInvoices = async (filters: {
  clientAccountIds?: string[];
  limit?: number;
  matterIds?: string[];
  offset?: number;
}) => {
  const where: string[] = ['inv.archived_at IS NULL'];
  const params: unknown[] = [];

  if (filters.clientAccountIds?.length) {
    where.push(`ca.public_id IN (${buildInClause(filters.clientAccountIds)})`);
    params.push(...filters.clientAccountIds);
  }

  if (filters.matterIds?.length) {
    where.push(`m.public_id IN (${buildInClause(filters.matterIds)})`);
    params.push(...filters.matterIds);
  }

  const invoiceRows = await queryRows<InvoiceRow>(
    `SELECT
       inv.id AS dbId,
       inv.public_id AS id,
       ca.public_id AS clientId,
       ca.display_name AS clientName,
       m.public_id AS matterId,
       m.matter_number AS matterRef,
       m.title AS matterTitle,
       inv.subtotal_amount AS subtotal,
       inv.currency_code AS currencyCode,
       inv.tax_amount AS tax,
       inv.discount_amount AS discount,
       inv.total_amount AS totalAmount,
       inv.status_code AS status,
       inv.issue_date AS issueDate,
       inv.due_date AS dueDate,
       inv.template_public_id_snapshot AS templateId,
       inv.template_version_snapshot AS templateVersion,
       inv.rendered_subject_snapshot AS renderedSubject,
       inv.rendered_body_snapshot AS renderedBody,
       inv.rendered_terms_snapshot AS renderedTerms,
       inv.rendered_footer_snapshot AS renderedFooter,
       COALESCE(inv.business_name_snapshot, settings.business_legal_name, settings.billing_display_name) AS businessName,
       COALESCE(inv.business_address_snapshot, settings.business_address) AS businessAddress,
       COALESCE(inv.business_phone_snapshot, settings.business_phone) AS businessPhone,
       COALESCE(inv.business_email_snapshot, settings.business_email) AS businessEmail,
       COALESCE(inv.business_website_snapshot, settings.business_website) AS businessWebsite,
       COALESCE(inv.business_gstin_snapshot, settings.gstin) AS businessGstin,
       COALESCE(inv.business_state_snapshot, settings.business_state) AS businessState,
       COALESCE(inv.payment_instructions_snapshot, settings.payment_instructions) AS businessPaymentInstructions,
       bs.billing_name AS billingName,
       bs.billing_email AS billingEmail,
       bs.billing_phone AS billingPhone,
       bs.address_line1 AS billingAddressLine1,
       bs.address_line2 AS billingAddressLine2,
       bs.city AS billingCity,
       bs.state AS billingState,
       bs.postal_code AS billingPostalCode,
       bs.country_code AS billingCountryCode,
       bs.gstin AS billingGstin,
       (
         SELECT MAX(pt.captured_at)
         FROM payment_allocations pa
         INNER JOIN payment_transactions pt
           ON pt.id = pa.payment_transaction_id
          AND pt.status_code = 'captured'
         WHERE pa.invoice_id = inv.id
       ) AS paidDate
     FROM invoices inv
     JOIN client_accounts ca ON ca.id = inv.client_account_id
     LEFT JOIN matters m ON m.id = inv.matter_id
     LEFT JOIN invoice_billing_snapshots bs ON bs.invoice_id = inv.id
     CROSS JOIN invoice_settings settings
     WHERE ${where.join(' AND ')}
     ORDER BY inv.issue_date DESC, inv.created_at DESC
     ${filters.limit ? 'LIMIT ? OFFSET ?' : ''}`,
    filters.limit ? [...params, filters.limit, filters.offset ?? 0] : params
  );

  if (invoiceRows.length === 0) {
    return [];
  }

  const invoiceDbIds = invoiceRows.map((row) => row.dbId);
  const lineRows = await queryRows<InvoiceLineRow>(
    `SELECT
       invoice_id AS invoiceDbId,
       id AS invoiceLineDbId,
       description,
       quantity,
       unit_price AS rate,
       line_total AS amount
     FROM invoice_lines
     WHERE invoice_id IN (${buildInClause(invoiceDbIds)})
     ORDER BY sort_order ASC, id ASC`,
    invoiceDbIds
  );
  const lineIds = lineRows.map((row) => row.invoiceLineDbId);
  const taxRows = lineIds.length
    ? await queryRows<InvoiceLineTaxRow>(
        `SELECT
           invoice_line_id AS invoiceLineDbId,
           tax_code_snapshot AS code,
           tax_name_snapshot AS name,
           tax_percent_snapshot AS percent,
           taxable_amount AS taxableAmount,
           tax_amount AS amount
         FROM invoice_line_taxes
         WHERE invoice_line_id IN (${buildInClause(lineIds)})
         ORDER BY sort_order ASC, id ASC`,
        lineIds
      )
    : [];

  const linesByInvoiceId = lineRows.reduce<Record<number, InvoiceLineRow[]>>((accumulator, row) => {
    accumulator[row.invoiceDbId] = accumulator[row.invoiceDbId] || [];
    accumulator[row.invoiceDbId]!.push(row);
    return accumulator;
  }, {});
  const taxesByLineId = taxRows.reduce<Record<number, InvoiceLineTaxRow[]>>((accumulator, row) => {
    accumulator[row.invoiceLineDbId] = accumulator[row.invoiceLineDbId] || [];
    accumulator[row.invoiceLineDbId]!.push(row);
    return accumulator;
  }, {});

  return invoiceRows.map((row) => ({
    amount: row.subtotal,
    clientId: row.clientId,
    clientName: row.clientName,
    currencyCode: row.currencyCode || 'USD',
    discount: row.discount,
    business: {
      address: row.businessAddress,
      email: row.businessEmail,
      gstin: row.businessGstin,
      name: row.businessName,
      paymentInstructions: row.businessPaymentInstructions,
      phone: row.businessPhone,
      state: row.businessState,
      website: row.businessWebsite,
    },
    billingSnapshot: row.billingName
      ? {
          addressLine1: row.billingAddressLine1,
          addressLine2: row.billingAddressLine2,
          billingEmail: row.billingEmail,
          billingName: row.billingName,
          billingPhone: row.billingPhone,
          city: row.billingCity,
          countryCode: row.billingCountryCode,
          gstin: row.billingGstin,
          postalCode: row.billingPostalCode,
          state: row.billingState,
        }
      : null,
    dueDate: toUiDate(row.dueDate),
    id: row.id,
    internalNote: undefined,
    issueDate: toUiDate(row.issueDate),
    items: (linesByInvoiceId[row.dbId] || []).map((line) => ({
      amount: line.amount,
      description: line.description,
      quantity: line.quantity,
      rate: line.rate,
      taxes: (taxesByLineId[line.invoiceLineDbId] || []).map((tax) => ({
        amount: tax.amount,
        code: tax.code,
        name: tax.name,
        percent: tax.percent,
        taxableAmount: tax.taxableAmount,
      })),
    })),
    lastReminder: undefined,
    matterId: row.matterId || '',
    matterRef: row.matterRef || '',
    matterTitle: row.matterTitle || '',
    paidDate: row.paidDate ? toUiDate(row.paidDate) : undefined,
    status: row.status,
    tax: row.tax,
    template: {
      body: row.renderedBody,
      footer: row.renderedFooter,
      id: row.templateId,
      subject: row.renderedSubject,
      terms: row.renderedTerms,
      version: row.templateVersion,
    },
    totalAmount: row.totalAmount,
  }));
};

export const countInvoices = async (filters: { clientAccountIds?: string[]; matterIds?: string[] }) => {
  const where: string[] = ['inv.archived_at IS NULL'];
  const params: unknown[] = [];

  if (filters.clientAccountIds?.length) {
    where.push(`ca.public_id IN (${buildInClause(filters.clientAccountIds)})`);
    params.push(...filters.clientAccountIds);
  }

  if (filters.matterIds?.length) {
    where.push(`m.public_id IN (${buildInClause(filters.matterIds)})`);
    params.push(...filters.matterIds);
  }

  const rows = await queryRows<RowDataPacket & { total: number }>(
    `SELECT COUNT(DISTINCT inv.id) AS total
     FROM invoices inv
     JOIN client_accounts ca ON ca.id = inv.client_account_id
     LEFT JOIN matters m ON m.id = inv.matter_id
     WHERE ${where.join(' AND ')}`,
    params
  );

  return Number(rows[0]?.total || 0);
};

export const fetchInvoiceSummaries = async (filters: {
  clientAccountIds?: string[];
  limit?: number;
  matterIds?: string[];
  offset?: number;
}) => {
  const where: string[] = ['inv.archived_at IS NULL'];
  const params: unknown[] = [];

  if (filters.clientAccountIds?.length) {
    where.push(`ca.public_id IN (${buildInClause(filters.clientAccountIds)})`);
    params.push(...filters.clientAccountIds);
  }

  if (filters.matterIds?.length) {
    where.push(`m.public_id IN (${buildInClause(filters.matterIds)})`);
    params.push(...filters.matterIds);
  }

  const rows = await queryRows<InvoiceSummaryRow>(
    `SELECT
       inv.public_id AS id,
       ca.public_id AS clientId,
       ca.display_name AS clientName,
       m.public_id AS matterId,
       m.matter_number AS matterRef,
       m.title AS matterTitle,
       inv.subtotal_amount AS subtotal,
       inv.currency_code AS currencyCode,
       inv.tax_amount AS tax,
       inv.discount_amount AS discount,
       inv.total_amount AS totalAmount,
       inv.status_code AS status,
       inv.issue_date AS issueDate,
       inv.due_date AS dueDate
     FROM invoices inv
     JOIN client_accounts ca ON ca.id = inv.client_account_id
     LEFT JOIN matters m ON m.id = inv.matter_id
     WHERE ${where.join(' AND ')}
     ORDER BY inv.issue_date DESC, inv.created_at DESC
     ${filters.limit ? 'LIMIT ? OFFSET ?' : ''}`,
    filters.limit ? [...params, filters.limit, filters.offset ?? 0] : params
  );

  return rows.map((row) => ({
    amount: row.subtotal,
    billingSnapshot: null,
    business: undefined,
    clientId: row.clientId,
    clientName: row.clientName,
    currencyCode: row.currencyCode || 'USD',
    discount: row.discount,
    dueDate: toUiDate(row.dueDate),
    id: row.id,
    internalNote: undefined,
    issueDate: toUiDate(row.issueDate),
    items: [],
    lastReminder: undefined,
    matterId: row.matterId || '',
    matterRef: row.matterRef || '',
    matterTitle: row.matterTitle || '',
    paidDate: undefined,
    status: row.status,
    tax: row.tax,
    template: undefined,
    totalAmount: row.totalAmount,
  }));
};

export const fetchDocuments = async (filters: {
  clientAccountIds?: string[];
  limit?: number;
  matterIds?: string[];
  offset?: number;
}) => {
  const where: string[] = ['d.archived_at IS NULL'];
  const params: unknown[] = [];

  if (filters.clientAccountIds?.length) {
    where.push(`ca.public_id IN (${buildInClause(filters.clientAccountIds)})`);
    params.push(...filters.clientAccountIds);
  }

  if (filters.matterIds?.length) {
    where.push(`m.public_id IN (${buildInClause(filters.matterIds)})`);
    params.push(...filters.matterIds);
  }

  const rows = await queryRows<DocumentRow>(
    `SELECT
       d.public_id AS id,
       COALESCE(dv.original_file_name, d.title) AS name,
       UPPER(COALESCE(dv.file_extension, 'FILE')) AS type,
       COALESCE(dv.file_size_bytes, 0) AS size,
       m.public_id AS matterId,
       m.title AS matterTitle,
       ca.public_id AS clientId,
       ca.display_name AS clientName,
       uploader.display_name AS uploadedBy,
       COALESCE(dv.uploaded_at, d.created_at) AS uploadedAt,
       d.visibility_scope_code AS visibilityScope,
       COALESCE(dv.virus_scan_status_code, 'pending') AS reviewStateSource,
       COALESCE(dv.virus_scan_status_code, 'unscanned') AS virusStatus,
       d.category_code AS docCategory,
       NULL AS note
     FROM documents d
     JOIN client_accounts ca ON ca.id = d.owner_client_account_id
     LEFT JOIN document_versions dv ON dv.document_id = d.id AND dv.is_current = 1
     LEFT JOIN matter_documents md ON md.document_id = d.id
     LEFT JOIN matters m ON m.id = md.matter_id
     JOIN users uploader ON uploader.id = d.created_by_user_id
     WHERE ${where.join(' AND ')}
     GROUP BY
       d.id, d.public_id, COALESCE(dv.original_file_name, d.title), UPPER(COALESCE(dv.file_extension, 'FILE')),
       COALESCE(dv.file_size_bytes, 0), m.public_id, m.title, ca.public_id, ca.display_name,
       uploader.display_name, COALESCE(dv.uploaded_at, d.created_at), d.visibility_scope_code,
       COALESCE(dv.virus_scan_status_code, 'pending'), COALESCE(dv.virus_scan_status_code, 'unscanned'), d.category_code
     ORDER BY COALESCE(dv.uploaded_at, d.created_at) DESC
     ${filters.limit ? 'LIMIT ? OFFSET ?' : ''}`,
    filters.limit ? [...params, filters.limit, filters.offset ?? 0] : params
  );

  return rows.map((row) => ({
    clientId: row.clientId,
    clientName: row.clientName,
    docCategory: row.docCategory,
    id: row.id,
    matterId: row.matterId || '',
    matterTitle: row.matterTitle || '',
    name: row.name,
    note: row.note || undefined,
    reviewState: mapReviewState(row.reviewStateSource),
    size: row.size,
    type: row.type,
    uploadedAt: toUiDateTime(row.uploadedAt),
    uploadedBy: row.uploadedBy,
    visibility: mapVisibility(row.visibilityScope),
    virusStatus: row.virusStatus,
  }));
};

export const countDocuments = async (filters: { clientAccountIds?: string[]; matterIds?: string[] }) => {
  const where: string[] = ['d.archived_at IS NULL'];
  const params: unknown[] = [];

  if (filters.clientAccountIds?.length) {
    where.push(`ca.public_id IN (${buildInClause(filters.clientAccountIds)})`);
    params.push(...filters.clientAccountIds);
  }

  if (filters.matterIds?.length) {
    where.push(`m.public_id IN (${buildInClause(filters.matterIds)})`);
    params.push(...filters.matterIds);
  }

  const rows = await queryRows<RowDataPacket & { total: number }>(
    `SELECT COUNT(DISTINCT d.id) AS total
     FROM documents d
     JOIN client_accounts ca ON ca.id = d.owner_client_account_id
     LEFT JOIN matter_documents md ON md.document_id = d.id
     LEFT JOIN matters m ON m.id = md.matter_id
     WHERE ${where.join(' AND ')}`,
    params
  );

  return Number(rows[0]?.total || 0);
};

export const fetchEvents = async (filters: {
  clientAccountIds?: string[];
  includeCancelled?: boolean;
  limit?: number;
  matterIds?: string[];
  offset?: number;
}) => {
  const where: string[] = filters.includeCancelled ? ['1 = 1'] : ['e.cancelled_at IS NULL'];
  const params: unknown[] = [];

  if (filters.clientAccountIds?.length) {
    where.push(`ca.public_id IN (${buildInClause(filters.clientAccountIds)})`);
    params.push(...filters.clientAccountIds);
  }

  if (filters.matterIds?.length) {
    where.push(`m.public_id IN (${buildInClause(filters.matterIds)})`);
    params.push(...filters.matterIds);
  }

  const rows = await queryRows<EventRow>(
    `SELECT
       e.public_id AS id,
       e.title,
       e.event_type_code AS type,
       ca.public_id AS clientId,
       ca.display_name AS clientName,
       m.public_id AS matterId,
       m.title AS matterTitle,
       e.scheduled_start_at AS dateSource,
       TIMESTAMPDIFF(MINUTE, e.scheduled_start_at, e.scheduled_end_at) AS duration,
       e.mode_code AS mode,
       e.location_text AS location,
       e.join_url AS joinUrl,
       e.calendar_sync_error_text AS calendarSyncError,
       e.calendar_synced_at AS calendarSyncedAt,
       e.meet_conference_id AS meetConferenceId,
       e.calendar_owner_email AS calendarOwnerEmail,
       COALESCE(e.google_attendee_status_code, 'not_applicable') AS googleAttendeeStatus,
       e.client_visible_flag AS visibleToClient,
       e.notes,
       e.status_code AS status,
       CASE
         WHEN e.calendar_sync_status_code IN ('cancelled', 'pending', 'synced', 'failed', 'local', 'disabled')
           THEN e.calendar_sync_status_code
         WHEN e.external_meeting_id IS NOT NULL THEN 'synced'
         WHEN e.meeting_provider_code = 'google-calendar-failed' THEN 'failed'
         WHEN e.meeting_provider_code IN ('manual', 'none') THEN 'local'
         ELSE 'disabled'
       END AS calendarSyncStatus,
       (
         SELECT COUNT(*)
         FROM event_reminders er
         WHERE er.event_id = e.id
           AND er.delivery_status_code = 'pending'
       ) AS reminderCount,
       CASE
         WHEN e.status_code = 'cancelled' OR e.cancelled_at IS NOT NULL THEN 'cancelled'
         WHEN (
           SELECT COUNT(*)
           FROM event_reminders er
           WHERE er.event_id = e.id
             AND er.delivery_status_code = 'pending'
         ) > 0 THEN 'scheduled'
         ELSE 'none'
       END AS reminderStatus
     FROM events e
     JOIN client_accounts ca ON ca.id = e.client_account_id
     LEFT JOIN matters m ON m.id = e.matter_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.scheduled_start_at ASC
     ${filters.limit ? 'LIMIT ? OFFSET ?' : ''}`,
    filters.limit ? [...params, filters.limit, filters.offset ?? 0] : params
  );

  return rows.map((row) => ({
    actionCTA: row.joinUrl ? 'Join Call' : 'View Details',
    calendarSyncError: row.calendarSyncError || undefined,
    calendarSyncStatus: row.calendarSyncStatus,
    calendarSyncedAt: row.calendarSyncedAt || undefined,
    calendarOwnerEmail: row.calendarOwnerEmail || undefined,
    clientId: row.clientId,
    clientName: row.clientName,
    date: toUiDate(row.dateSource),
    duration: row.duration,
    googleAttendeeStatus: row.googleAttendeeStatus,
    id: row.id,
    joinUrl: row.joinUrl || undefined,
    location: row.location || undefined,
    matterId: row.matterId || '',
    matterTitle: row.matterTitle || '',
    meetConferenceId: row.meetConferenceId || undefined,
    meetLink: row.joinUrl || undefined,
    mode: row.mode,
    notes: row.notes || '',
    reminderCount: Number(row.reminderCount || 0),
    reminderStatus: row.reminderStatus,
    status: row.status,
    time: toUiTime(row.dateSource),
    title: row.title,
    type: row.type,
    visibleToClient: Boolean(row.visibleToClient),
  }));
};

export const countEvents = async (filters: {
  clientAccountIds?: string[];
  includeCancelled?: boolean;
  matterIds?: string[];
}) => {
  const where: string[] = filters.includeCancelled ? ['1 = 1'] : ['e.cancelled_at IS NULL'];
  const params: unknown[] = [];

  if (filters.clientAccountIds?.length) {
    where.push(`ca.public_id IN (${buildInClause(filters.clientAccountIds)})`);
    params.push(...filters.clientAccountIds);
  }

  if (filters.matterIds?.length) {
    where.push(`m.public_id IN (${buildInClause(filters.matterIds)})`);
    params.push(...filters.matterIds);
  }

  const rows = await queryRows<RowDataPacket & { total: number }>(
    `SELECT COUNT(DISTINCT e.id) AS total
     FROM events e
     JOIN client_accounts ca ON ca.id = e.client_account_id
     LEFT JOIN matters m ON m.id = e.matter_id
     WHERE ${where.join(' AND ')}`,
    params
  );

  return Number(rows[0]?.total || 0);
};

export const fetchThreads = async (filters: {
  clientAccountIds?: string[];
  limit?: number;
  matterIds?: string[];
  offset?: number;
  viewerUserId?: number;
}) => {
  const where: string[] = ['ct.archived_at IS NULL'];
  const params: unknown[] = [];
  const unreadSelectParams: unknown[] = [];

  if (filters.clientAccountIds?.length) {
    where.push(`ca.public_id IN (${buildInClause(filters.clientAccountIds)})`);
    params.push(...filters.clientAccountIds);
  }

  if (filters.matterIds?.length) {
    where.push(`m.public_id IN (${buildInClause(filters.matterIds)})`);
    params.push(...filters.matterIds);
  }

  const unreadCountSelect = filters.viewerUserId
    ? `(
       SELECT COUNT(*)
       FROM messages unread_msg
       INNER JOIN users unread_sender
         ON unread_sender.id = unread_msg.sender_user_id
        AND unread_sender.actor_type_code = 'client'
       LEFT JOIN message_reads unread_read
         ON unread_read.message_id = unread_msg.id
        AND unread_read.user_id = ?
       WHERE unread_msg.thread_id = ct.id
         AND unread_msg.deleted_at IS NULL
         AND (unread_msg.sender_user_id IS NULL OR unread_msg.sender_user_id <> ?)
         AND unread_read.id IS NULL
     ) AS unreadCount`
    : `CASE WHEN ct.status_code = 'waiting' THEN 1 ELSE 0 END AS unreadCount`;

  if (filters.viewerUserId) {
    unreadSelectParams.push(filters.viewerUserId, filters.viewerUserId);
  }

  const selectColumns = `SELECT
       ct.public_id AS id,
       ca.public_id AS clientId,
       ca.display_name AS clientName,
       m.public_id AS matterId,
       m.title AS matterTitle,
       m.matter_number AS matterRef,
       ct.subject AS subject,
       m.current_stage_code AS stage,
       pur.urgency_code AS urgency,
       lm.body_text AS lastMessage,
       COALESCE(lm.sent_at, ct.last_message_at, ct.updated_at) AS lastMessageAt,
       owner.display_name AS assignedTo,
       ct.status_code AS status,
       ${unreadCountSelect}`;

  const baseJoins = `
     JOIN client_accounts ca ON ca.id = ct.client_account_id
     LEFT JOIN matters m ON m.id = ct.matter_id`;

  const detailJoins = `
     LEFT JOIN pricing_urgency_rules pur ON pur.id = m.urgency_rule_id
     LEFT JOIN users owner ON owner.id = ct.assigned_owner_user_id
     LEFT JOIN messages lm ON lm.id = (
       SELECT m2.id
       FROM messages m2
       WHERE m2.thread_id = ct.id AND m2.deleted_at IS NULL
       ORDER BY m2.sent_at DESC, m2.id DESC
       LIMIT 1
     )`;

  const rows = filters.limit
    ? await queryRows<ThreadRow>(
        `${selectColumns}
         FROM (
           SELECT ct.id
           FROM conversation_threads ct
           ${baseJoins}
           WHERE ${where.join(' AND ')}
           ORDER BY COALESCE(ct.last_message_at, ct.updated_at) DESC
           LIMIT ? OFFSET ?
         ) page
         JOIN conversation_threads ct ON ct.id = page.id
         ${baseJoins}
         ${detailJoins}
         ORDER BY COALESCE(ct.last_message_at, ct.updated_at) DESC`,
        [...unreadSelectParams, ...params, filters.limit, filters.offset ?? 0]
      )
    : await queryRows<ThreadRow>(
        `${selectColumns}
         FROM conversation_threads ct
         ${baseJoins}
         ${detailJoins}
         WHERE ${where.join(' AND ')}
         ORDER BY COALESCE(ct.last_message_at, ct.updated_at) DESC`,
        [...unreadSelectParams, ...params]
      );

  return rows.map((row) => ({
    assignedTo: row.assignedTo || 'Unassigned',
    clientId: row.clientId,
    clientName: row.clientName,
    id: row.id,
    lastMessage: row.lastMessage || '',
    lastMessageAt: row.lastMessageAt ? toUiDateTime(row.lastMessageAt) : '',
    matterId: row.matterId || '',
    matterRef: row.matterRef || '',
    matterTitle: row.matterTitle || row.subject || 'General Support',
    stage: row.stage || 'request-received',
    status: row.status,
    unreadCount: Number(row.unreadCount || 0),
    urgency: row.urgency || 'standard',
  }));
};

export const countThreads = async (filters: { clientAccountIds?: string[]; matterIds?: string[] }) => {
  const where: string[] = ['ct.archived_at IS NULL'];
  const params: unknown[] = [];

  if (filters.clientAccountIds?.length) {
    where.push(`ca.public_id IN (${buildInClause(filters.clientAccountIds)})`);
    params.push(...filters.clientAccountIds);
  }

  if (filters.matterIds?.length) {
    where.push(`m.public_id IN (${buildInClause(filters.matterIds)})`);
    params.push(...filters.matterIds);
  }

  const rows = await queryRows<RowDataPacket & { total: number }>(
    `SELECT COUNT(DISTINCT ct.id) AS total
     FROM conversation_threads ct
     JOIN client_accounts ca ON ca.id = ct.client_account_id
     LEFT JOIN matters m ON m.id = ct.matter_id
     WHERE ${where.join(' AND ')}`,
    params
  );

  return Number(rows[0]?.total || 0);
};

export const fetchMessagesByThreadIds = async (threadIds: string[]) => {
  if (threadIds.length === 0) {
    return [];
  }

  const rows = await queryRows<MessageRow>(
    `SELECT
       msg.public_id AS id,
       ct.public_id AS threadId,
       CASE
         WHEN msg.sender_system_code IS NOT NULL
           OR (msg.body_text = ? AND msg.sent_at = ct.created_at)
         THEN CONCAT('system:', COALESCE(msg.sender_system_code, 'global_lmg'))
         ELSE COALESCE(u.public_id, CONCAT('system:', COALESCE(msg.sender_system_code, 'unknown')))
       END AS senderId,
       CASE
         WHEN msg.sender_system_code IS NOT NULL
           OR (msg.body_text = ? AND msg.sent_at = ct.created_at)
         THEN 'Global LMG'
         ELSE COALESCE(u.display_name, cp.full_name, 'System')
       END AS senderName,
       CASE
         WHEN msg.sender_system_code IS NOT NULL
           OR (msg.body_text = ? AND msg.sent_at = ct.created_at)
         THEN 'system'
         WHEN u.actor_type_code = 'client' THEN 'client'
         ELSE 'admin'
       END AS senderRole,
       msg.body_text AS content,
       msg.sent_at AS timestamp,
       GROUP_CONCAT(CONCAT(d.public_id, '\u001F', dv.original_file_name) ORDER BY mdv.sort_order ASC SEPARATOR '\u001E') AS attachmentRefs
     FROM messages msg
     JOIN conversation_threads ct ON ct.id = msg.thread_id
     LEFT JOIN users u ON u.id = msg.sender_user_id
     LEFT JOIN counsel_partners cp ON cp.id = msg.sender_counsel_partner_id
     LEFT JOIN message_document_versions mdv ON mdv.message_id = msg.id
     LEFT JOIN document_versions dv ON dv.id = mdv.document_version_id
     LEFT JOIN documents d ON d.id = dv.document_id
     WHERE msg.deleted_at IS NULL
       AND ct.public_id IN (${buildInClause(threadIds)})
     GROUP BY
       msg.id,
       msg.public_id,
       ct.public_id,
       u.public_id,
       msg.sender_system_code,
       ct.created_at,
       u.display_name,
       cp.full_name,
       u.actor_type_code,
       msg.body_text,
       msg.sent_at
     ORDER BY msg.sent_at ASC, msg.id ASC`,
    [
      AUTOMATIC_REQUEST_ACKNOWLEDGEMENT,
      AUTOMATIC_REQUEST_ACKNOWLEDGEMENT,
      AUTOMATIC_REQUEST_ACKNOWLEDGEMENT,
      ...threadIds,
    ]
  );

  return rows.map((row) => ({
    attachments: parseAttachmentRefs(row.attachmentRefs),
    content: row.content,
    id: row.id,
    read: true,
    senderId: row.senderId || '',
    senderName: row.senderName || 'Unknown',
    senderRole: row.senderRole,
    threadId: row.threadId,
    timestamp: toUiDateTime(row.timestamp),
  }));
};

export const fetchPayments = async (filters: {
  clientAccountIds?: string[];
  invoiceIds?: string[];
  matterIds?: string[];
} = {}) => {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.clientAccountIds?.length) {
    where.push(`ca.public_id IN (${buildInClause(filters.clientAccountIds)})`);
    params.push(...filters.clientAccountIds);
  }

  if (filters.invoiceIds?.length) {
    where.push(`inv.public_id IN (${buildInClause(filters.invoiceIds)})`);
    params.push(...filters.invoiceIds);
  }

  if (filters.matterIds?.length) {
    where.push(`m.public_id IN (${buildInClause(filters.matterIds)})`);
    params.push(...filters.matterIds);
  }

  const rows = await queryRows<PaymentRow>(
    `SELECT
       pt.public_id AS id,
       inv.public_id AS invoiceId,
       m.public_id AS matterId,
       ca.public_id AS clientId,
       ca.display_name AS clientName,
       COALESCE(pa.amount_applied, pt.gross_amount) AS amount,
       CASE
         WHEN pt.gateway_provider_code IN ('bank-transfer', 'cash', 'cheque', 'online')
           THEN pt.gateway_provider_code
         WHEN LOWER(COALESCE(pm.method_type_code, '')) LIKE '%bank%' THEN 'bank-transfer'
         WHEN LOWER(COALESCE(pm.method_type_code, '')) LIKE '%cash%' THEN 'cash'
         WHEN LOWER(COALESCE(pm.method_type_code, '')) LIKE '%cheque%' THEN 'cheque'
         ELSE 'online'
       END AS method,
       CASE
         WHEN pt.status_code IN ('refunded', 'partially-refunded') THEN 'refunded'
         WHEN pt.status_code = 'captured' THEN 'success'
         ELSE 'failed'
       END AS status,
       COALESCE(pt.captured_at, pt.failed_at, pt.created_at) AS timestamp,
       creator.display_name AS recordedBy,
       COALESCE(pt.gateway_payment_ref, pt.gateway_order_ref, pt.public_id) AS reference
     FROM payment_transactions pt
     LEFT JOIN payment_methods pm ON pm.id = pt.payment_method_id
     LEFT JOIN payment_allocations pa ON pa.payment_transaction_id = pt.id
     LEFT JOIN invoices inv ON inv.id = pa.invoice_id
     LEFT JOIN matters m ON m.id = inv.matter_id
     JOIN client_accounts ca ON ca.id = pt.client_account_id
     LEFT JOIN users creator ON creator.id = pt.created_by_user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY COALESCE(pt.captured_at, pt.created_at) DESC`,
    params
  );

  return rows.map((row) => ({
    amount: row.amount,
    clientId: row.clientId,
    clientName: row.clientName,
    id: row.id,
    invoiceId: row.invoiceId || '',
    matterId: row.matterId || '',
    method: row.method,
    recordedBy: row.recordedBy || 'System',
    reference: row.reference || row.id,
    status: row.status,
    timestamp: toUiDateTime(row.timestamp),
  }));
};

export const fetchClientAudit = async (matterPublicIds: string[]) => {
  if (matterPublicIds.length === 0) {
    return [];
  }

  const rows = await queryRows<AuditRow>(
    `SELECT
       ae.public_id AS id,
       ae.occurred_at AS timestamp,
       actor.display_name AS actor,
       ae.actor_role_code_snapshot AS actorRole,
       ae.entity_table_name AS entityType,
       COALESCE(m.public_id, ae.public_id) AS entityId,
       ae.action_label AS action,
       ae.source_module AS sourceModule
     FROM audit_events ae
     LEFT JOIN users actor ON actor.id = ae.actor_user_id
     LEFT JOIN matters m ON ae.entity_table_name = 'matters' AND m.id = ae.entity_pk
     WHERE ae.entity_table_name = 'matters'
       AND m.public_id IN (${buildInClause(matterPublicIds)})
     ORDER BY ae.occurred_at DESC
     LIMIT 20`,
    matterPublicIds
  );

  return rows.map((row) => ({
    action: row.action,
    actor: row.actor || 'System',
    actorRole: row.actorRole,
    details: `${row.sourceModule} update`,
    entityId: row.entityId,
    entityType: row.entityType.replace(/s$/, ''),
    id: row.id,
    sourceModule: row.sourceModule,
    timestamp: toUiDateTime(row.timestamp),
  }));
};

export const fetchClientsForList = async (options: { limit: number; offset: number; search?: string }) => {
  const params: unknown[] = [];
  const searchClause = options.search
    ? `AND (ca.display_name LIKE ? OR ca.primary_email LIKE ? OR ca.primary_phone LIKE ?)`
    : '';

  if (options.search) {
    const searchValue = `%${options.search}%`;
    params.push(searchValue, searchValue, searchValue);
  }

  const rows = await queryRows<
    RowDataPacket & {
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
    }
  >(
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
     WHERE ca.archived_at IS NULL
       ${searchClause}
     ORDER BY ca.updated_at DESC
     LIMIT ? OFFSET ?`,
    [...params, options.limit, options.offset]
  );

  return rows.map((row) => ({
    activeMatters: row.activeMatters,
    email: row.email,
    hasUnread: Boolean(row.hasUnread),
    id: row.id,
    joinedAt: toUiDate(row.joinedAt),
    lastActiveAt: row.lastActiveAt ? toUiDate(row.lastActiveAt) : toUiDate(row.joinedAt),
    lifecycle: mapLifecycle(row.accountStatusCode, row.lifecycleSource),
    mattersCount: row.mattersCount,
    name: row.name,
    owner: row.owner || 'Unassigned',
    phone: row.phone,
    region: row.region || '',
    totalDue: row.totalDue,
  }));
};

export const fetchClientOptions = async (options: { limit: number; offset: number; search?: string }) => {
  const params: unknown[] = [];
  const searchClause = options.search
    ? `AND (ca.display_name LIKE ? OR ca.primary_email LIKE ? OR ca.primary_phone LIKE ?)`
    : '';

  if (options.search) {
    const searchValue = `%${options.search}%`;
    params.push(searchValue, searchValue, searchValue);
  }

  const rows = await queryRows<ClientOptionRow>(
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
     WHERE ca.archived_at IS NULL
       ${searchClause}
     ORDER BY ca.updated_at DESC
     LIMIT ? OFFSET ?`,
    [...params, options.limit, options.offset]
  );

  return rows.map((row) => ({
    accountStatus: row.accountStatusCode,
    avatar: '',
    email: row.email,
    id: row.id,
    joinedAt: toUiDate(row.joinedAt),
    lastActiveAt: row.lastActiveAt ? toUiDate(row.lastActiveAt) : toUiDate(row.joinedAt),
    lifecycle: mapLifecycle(row.accountStatusCode, row.lifecycleSource),
    name: row.name,
    owner: row.owner || 'Unassigned',
    phone: row.phone,
    region: row.region || '',
  }));
};

export const countClientsForList = async (options: { search?: string } = {}) => {
  const params: unknown[] = [];
  const searchClause = options.search
    ? `AND (ca.display_name LIKE ? OR ca.primary_email LIKE ? OR ca.primary_phone LIKE ?)`
    : '';

  if (options.search) {
    const searchValue = `%${options.search}%`;
    params.push(searchValue, searchValue, searchValue);
  }

  const rows = await queryRows<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total
     FROM client_accounts ca
     WHERE ca.archived_at IS NULL
       ${searchClause}`,
    params
  );

  return Number(rows[0]?.total || 0);
};

export const fetchClientsByIds = async (clientPublicIds: string[]) => {
  if (clientPublicIds.length === 0) {
    return [];
  }

  const rows = await queryRows<
    RowDataPacket & {
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
    }
  >(
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
     WHERE ca.archived_at IS NULL
       AND ca.public_id IN (${buildInClause(clientPublicIds)})
     ORDER BY ca.updated_at DESC`,
    clientPublicIds
  );

  const clientsById = new Map(
    rows.map((row) => [
      row.id,
      {
        avatar: '',
        email: row.email,
        id: row.id,
        joinedAt: toUiDate(row.joinedAt),
        lastActiveAt: row.lastActiveAt ? toUiDate(row.lastActiveAt) : toUiDate(row.joinedAt),
        lifecycle: mapLifecycle(row.accountStatusCode, row.lifecycleSource),
        name: row.name,
        owner: row.owner || 'Unassigned',
        phone: row.phone,
        region: row.region || '',
      },
    ])
  );

  return clientPublicIds
    .map((clientId) => clientsById.get(clientId))
    .filter((client): client is NonNullable<typeof client> => Boolean(client));
};
