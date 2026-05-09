import type { RowDataPacket } from 'mysql2/promise';
import { badRequest, notFound } from '../../lib/httpErrors.js';
import { executeStatement, queryRows, withTransaction, type QueryExecutor } from '../../lib/mysql.js';
import type { AdminActor } from '../auth/service.js';
import {
  buildPaginationMeta,
  countInvoices,
  fetchInvoices,
  fetchMatterOptions,
  fetchPayments,
  normalizePagination,
} from '../shared.js';
import {
  createAuditEvent,
  createClientNotifications,
  resolveInvoiceByPublicId,
  touchMatterActivity,
} from '../writeSupport.js';
import { createPublicId } from '../../lib/authCrypto.js';
import { applyInvoicePdfTemplateSnapshot } from '../settings/invoicePdfTemplates.js';
import { getInvoiceSettings } from '../settings/invoiceSettings.js';
import { calculateInvoiceTax, insertInvoiceLineTaxes } from './tax.js';
import { env } from '../../config/env.js';
import { sendEmail } from '../providers/email.js';
import { convertBaseAmount, normalizeCurrencyCode, summarizeFxSnapshots } from '../pricing/fx.js';
import {
  ensureInvoiceTemplateSnapshot,
  renderAndStoreInvoiceTemplateSnapshot,
} from './invoiceTemplateRendering.js';
import { logEvent } from '../../lib/observability.js';

type RefundRow = RowDataPacket & {
  amount: number;
  clientId: string | null;
  clientName: string | null;
  completedAt: string | null;
  id: string;
  invoiceId: string | null;
  matterId: string | null;
  paymentId: string;
  reasonText: string;
  requestedAt: string;
  requestedBy: string | null;
  status: string;
};

type PaymentSummaryRow = RowDataPacket & {
  clientAccountId: number;
  currencyCode: string;
  grossAmount: number;
  id: number;
  statusCode: string;
};

type PaymentInvoiceSummaryRow = RowDataPacket & {
  invoiceId: number | null;
  matterId: number | null;
};

type PaymentRefundedTotalRow = RowDataPacket & {
  refundedAmount: number;
};

type MatterBillingMetaRow = RowDataPacket & {
  billingName: string;
  city: string | null;
  clientAccountId: number;
  clientName: string;
  countryCode: string | null;
  email: string;
  gstin: string | null;
  line1: string | null;
  line2: string | null;
  matterDbId: number;
  matterNumber: string;
  phone: string;
  postalCode: string | null;
  state: string | null;
  title: string;
};

type InvoiceDispatchRow = RowDataPacket & {
  billingEmail: string | null;
  clientAccountId: number;
  clientName: string;
  currencyCode: string;
  invoiceDbId: number;
  invoiceId: string;
  invoiceNumber: string;
  matterDbId: number | null;
  matterId: string | null;
  matterTitle: string | null;
  statusCode: string;
  totalAmount: number;
 };

type InvoicePaymentRow = RowDataPacket & {
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  clientAccountId: number;
  currencyCode: string;
  invoiceDbId: number;
  invoiceId: string;
  invoiceNumber: string;
  matterDbId: number | null;
  matterId: string | null;
  matterTitle: string | null;
  statusCode: string;
  totalAmount: number;
};

type InstallmentAllocationRow = RowDataPacket & {
  amountRemaining: number;
  installmentDbId: number;
};

type DuplicatePaymentReferenceRow = RowDataPacket & {
  paymentId: string;
};

type ManualPaymentMethodCode = 'bank-transfer' | 'cash' | 'cheque' | 'online';

type PaymentMethodLookupRow = RowDataPacket & {
  id: number;
};

type InvoiceEmailRecipientRow = RowDataPacket & {
  email: string | null;
};

const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const ACTIVE_BILLING_CURRENCY_CODE = 'USD';
const MANUAL_PAYMENT_METHOD_LABELS: Record<ManualPaymentMethodCode, string> = {
  'bank-transfer': 'Bank transfer',
  cash: 'Cash',
  cheque: 'Cheque',
  online: 'Online manual payment',
};

const firstRow = <TRow>(rows: TRow[]) => rows[0] || null;

const toDateOnly = (value: Date) => value.toISOString().slice(0, 10);

const addDaysDateOnly = (days: number) => toDateOnly(new Date(Date.now() + days * 24 * 60 * 60 * 1000));

const toMinorUnits = (value: number | string) => {
  const normalized = String(value).trim();
  if (!MONEY_PATTERN.test(normalized)) {
    throw badRequest('invalid_money_amount', 'Amount must be a positive value with no more than 2 decimals.');
  }

  const [wholePart, fractionPart = ''] = normalized.split('.');
  const wholeMinor = Number(wholePart) * 100;
  const fractionMinor = Number(fractionPart.padEnd(2, '0'));
  return wholeMinor + fractionMinor;
};

const minorToDecimal = (minorUnits: number) => (minorUnits / 100).toFixed(2);

const maskEmail = (value: string) => {
  const [localPart, domainPart] = value.split('@');
  if (!localPart || !domainPart) {
    return 'configured-recipient';
  }

  return `${localPart.slice(0, 2)}***@${domainPart}`;
};

const formatInvoiceMoney = (amount: number, currencyCode: string) => {
  const normalizedCurrency = normalizeCurrencyCode(currencyCode) || 'USD';
  const formattedAmount = Number(amount || 0).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });

  return `${normalizedCurrency} ${formattedAmount}`;
};

const normalizeMoney = (value: number | string) => {
  const minorUnits = toMinorUnits(value);

  if (minorUnits <= 0) {
    throw badRequest('invalid_money_amount', 'Amount must be greater than zero.');
  }

  return {
    decimal: minorToDecimal(minorUnits),
    minorUnits,
  };
};

const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const normalizeManualPaymentMethodCode = (value: string): ManualPaymentMethodCode => {
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');

  if (normalized in MANUAL_PAYMENT_METHOD_LABELS) {
    return normalized as ManualPaymentMethodCode;
  }

  throw badRequest('invalid_payment_method', 'Select a valid manual payment method.');
};

const resolveManualPaymentMethodId = async (
  input: {
    actorUserId: number;
    clientAccountId: number;
    paymentMethod: string;
  },
  executor: QueryExecutor
) => {
  const methodCode = normalizeManualPaymentMethodCode(input.paymentMethod);
  const existing = firstRow(
    await queryRows<PaymentMethodLookupRow>(
      `SELECT id
       FROM payment_methods
       WHERE client_account_id = ?
         AND provider_code = 'manual'
         AND method_type_code = ?
         AND method_status_code = 'active'
         AND archived_at IS NULL
       ORDER BY is_default DESC, id ASC
       LIMIT 1`,
      [input.clientAccountId, methodCode],
      executor
    )
  );

  if (existing) {
    return existing.id;
  }

  const result = await executeStatement(
    `INSERT INTO payment_methods (
       public_id,
       client_account_id,
       added_by_user_id,
       provider_code,
       method_type_code,
       provider_customer_ref,
       provider_method_ref,
       display_label,
       brand_last4,
       expiry_month,
       expiry_year,
       upi_id,
       is_default,
       method_status_code,
       created_at,
       updated_at,
       archived_at
     ) VALUES (
       ?, ?, ?, 'manual', ?, NULL, ?, ?, NULL, NULL, NULL, NULL, 0, 'active',
       UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), NULL
     )`,
    [
      createPublicId(),
      input.clientAccountId,
      input.actorUserId,
      methodCode,
      methodCode,
      MANUAL_PAYMENT_METHOD_LABELS[methodCode],
    ],
    executor
  );

  return result.insertId;
};

const allocateInvoiceNumber = async (connection: QueryExecutor) => {
  const year = new Date().getUTCFullYear();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const rows = await queryRows<RowDataPacket & { nextValue: number }>(
    `SELECT next_value AS nextValue
     FROM business_sequences
     WHERE sequence_key = 'invoice' AND sequence_year = ?
     FOR UPDATE`,
    [year],
    connection
  );
  const current = rows[0];

  if (!current) {
    await executeStatement(
      `INSERT INTO business_sequences (
         sequence_key,
         sequence_year,
         next_value,
         created_at,
         updated_at
       ) VALUES ('invoice', ?, 2, ?, ?)`,
      [year, now, now],
      connection
    );

    return `INV-${year}-${String(1).padStart(3, '0')}`;
  }

  await executeStatement(
    `UPDATE business_sequences
     SET next_value = ?,
         updated_at = ?
     WHERE sequence_key = 'invoice'
       AND sequence_year = ?`,
    [Number(current.nextValue) + 1, now, year],
    connection
  );

  return `INV-${year}-${String(current.nextValue).padStart(3, '0')}`;
};

const getMatterBillingMeta = async (
  matterPublicId: string,
  executor?: Parameters<typeof queryRows>[2]
) => {
  const row = firstRow(
    await queryRows<MatterBillingMetaRow>(
      `SELECT
         m.id AS matterDbId,
         m.matter_number AS matterNumber,
         m.title,
         ca.id AS clientAccountId,
         ca.display_name AS clientName,
         ca.billing_name AS billingName,
         ca.primary_email AS email,
         ca.primary_phone AS phone,
         ca.gstin,
         addr.line1,
         addr.line2,
         addr.city,
         addr.state,
         addr.postal_code AS postalCode,
         addr.country_code AS countryCode
       FROM matters m
       INNER JOIN client_accounts ca ON ca.id = m.client_account_id
       LEFT JOIN client_addresses addr
         ON addr.client_account_id = ca.id
        AND addr.is_primary = 1
        AND addr.archived_at IS NULL
       WHERE m.public_id = ?
         AND m.archived_at IS NULL
       LIMIT 1`,
      [matterPublicId],
      executor
    )
  );

  if (!row) {
    throw notFound('matter_not_found', 'Matter not found.');
  }

  return row;
};

const getInvoiceDispatchMeta = async (
  invoicePublicId: string,
  executor?: Parameters<typeof queryRows>[2]
) => {
  const row = firstRow(
    await queryRows<InvoiceDispatchRow>(
      `SELECT
         inv.id AS invoiceDbId,
         inv.public_id AS invoiceId,
         inv.invoice_number AS invoiceNumber,
         inv.client_account_id AS clientAccountId,
         ca.display_name AS clientName,
         snapshot.billing_email AS billingEmail,
         inv.matter_id AS matterDbId,
         matter.public_id AS matterId,
         matter.title AS matterTitle,
         inv.status_code AS statusCode,
         inv.currency_code AS currencyCode,
         inv.total_amount AS totalAmount
       FROM invoices inv
       INNER JOIN client_accounts ca ON ca.id = inv.client_account_id
       LEFT JOIN invoice_billing_snapshots snapshot ON snapshot.invoice_id = inv.id
       LEFT JOIN matters matter ON matter.id = inv.matter_id
       WHERE inv.public_id = ?
         AND inv.archived_at IS NULL
       LIMIT 1`,
      [invoicePublicId],
      executor
    )
  );

  if (!row) {
    throw notFound('invoice_not_found', 'Invoice not found.');
  }

  return row;
};

const getInvoicePaymentMeta = async (
  invoicePublicId: string,
  executor?: Parameters<typeof queryRows>[2]
) => {
  const row = firstRow(
    await queryRows<InvoicePaymentRow>(
      `SELECT
         inv.id AS invoiceDbId,
         inv.public_id AS invoiceId,
         inv.invoice_number AS invoiceNumber,
         inv.client_account_id AS clientAccountId,
         inv.matter_id AS matterDbId,
         matter.public_id AS matterId,
         matter.title AS matterTitle,
         inv.status_code AS statusCode,
         inv.currency_code AS currencyCode,
         inv.total_amount AS totalAmount,
         inv.amount_paid AS amountPaid,
         inv.amount_refunded AS amountRefunded,
         inv.amount_due AS amountDue
       FROM invoices inv
       LEFT JOIN matters matter ON matter.id = inv.matter_id
       WHERE inv.public_id = ?
         AND inv.archived_at IS NULL
       LIMIT 1
       FOR UPDATE`,
      [invoicePublicId],
      executor
    )
  );

  if (!row) {
    throw notFound('invoice_not_found', 'Invoice not found.');
  }

  return row;
};

const getInvoiceEmailRecipient = async (invoiceDbId: number, executor: QueryExecutor) =>
  firstRow(
    await queryRows<InvoiceEmailRecipientRow>(
      `SELECT COALESCE(snapshot.billing_email, ca.primary_email) AS email
       FROM invoices inv
       INNER JOIN client_accounts ca ON ca.id = inv.client_account_id
       LEFT JOIN invoice_billing_snapshots snapshot ON snapshot.invoice_id = inv.id
       WHERE inv.id = ?
       LIMIT 1`,
      [invoiceDbId],
      executor
    )
  );

const resolveBillingCurrency = async (_countryCode: string | null | undefined, _executor: QueryExecutor) =>
  ACTIVE_BILLING_CURRENCY_CODE;

const auditInvoiceEmailDelivery = async (
  input: {
    actor: AdminActor;
    errorMessage?: string | null;
    invoiceDbId: number;
    providerCode: string;
    providerReference?: string | null;
    recipient: string;
    status: 'failed' | 'sent' | 'skipped_manual_mode';
  },
  executor: QueryExecutor
) => {
  await createAuditEvent(
    {
      actionCode: `invoice.email_${input.status}`,
      actionLabel:
        input.status === 'sent'
          ? 'Invoice email sent'
          : input.status === 'failed'
            ? 'Invoice email failed'
            : 'Invoice email skipped in manual/local mode',
      actorRoleCode: input.actor.roleCodes[0] || 'billing_admin',
      actorUserId: input.actor.userId,
      changes: [
        { fieldName: 'provider_code', newValue: input.providerCode },
        { fieldName: 'delivery_status', newValue: input.status },
        { fieldName: 'provider_reference', newValue: input.providerReference || null },
        { fieldName: 'failure_reason', newValue: input.errorMessage || null },
        { fieldName: 'recipient', newValue: input.recipient },
      ],
      entityPk: input.invoiceDbId,
      entityTableName: 'invoices',
      sourceModule: 'billing_workspace',
      summaryNewValue: {
        providerCode: input.providerCode,
        status: input.status,
      },
    },
    executor
  );
};

const sendInvoiceEmailIfConfigured = async (
  actor: AdminActor,
  invoiceDbId: number,
  executor: QueryExecutor
) => {
  const snapshot = await ensureInvoiceTemplateSnapshot(invoiceDbId, executor);
  const recipient = await getInvoiceEmailRecipient(invoiceDbId, executor);

  if (env.EMAIL_PROVIDER_MODE !== 'resend') {
    await auditInvoiceEmailDelivery(
      {
        actor,
        invoiceDbId,
        providerCode: env.EMAIL_PROVIDER_MODE,
        recipient: recipient?.email ? maskEmail(recipient.email) : 'missing-email',
        status: 'skipped_manual_mode',
      },
      executor
    );
    return { status: 'manual' as const };
  }

  if (!recipient?.email) {
    await auditInvoiceEmailDelivery(
      {
        actor,
        errorMessage: 'Invoice billing email is missing.',
        invoiceDbId,
        providerCode: 'resend',
        recipient: 'missing-email',
        status: 'failed',
      },
      executor
    );
    return { status: 'failed' as const };
  }

  const result = await sendEmail({
    subject: snapshot.subject,
    text: `${snapshot.body}\n\n${snapshot.terms}\n\n${snapshot.footer}`,
    to: recipient.email,
  });

  await auditInvoiceEmailDelivery(
    {
      actor,
      errorMessage: result.errorMessage || null,
      invoiceDbId,
      providerCode: result.providerCode,
      providerReference: result.providerReference || null,
      recipient: maskEmail(recipient.email),
      status: result.status === 'sent' ? 'sent' : 'failed',
    },
    executor
  );

  return { status: result.status === 'sent' ? ('sent' as const) : ('failed' as const) };
};

const listRefunds = async (filters: { invoiceIds?: string[] } = {}) => {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.invoiceIds?.length) {
    where.push(`inv.public_id IN (${filters.invoiceIds.map(() => '?').join(', ')})`);
    params.push(...filters.invoiceIds);
  }

  const rows = await queryRows<RefundRow>(
    `SELECT
       rf.public_id AS id,
       pt.public_id AS paymentId,
       inv.public_id AS invoiceId,
       matter.public_id AS matterId,
       ca.public_id AS clientId,
       ca.display_name AS clientName,
       rf.amount,
       rf.refund_status_code AS status,
       rf.reason_text AS reasonText,
       rf.requested_at AS requestedAt,
       rf.completed_at AS completedAt,
       requester.display_name AS requestedBy
     FROM refunds rf
     JOIN payment_transactions pt ON pt.id = rf.payment_transaction_id
     LEFT JOIN invoices inv ON inv.id = rf.invoice_id
     LEFT JOIN matters matter ON matter.id = inv.matter_id
     JOIN client_accounts ca ON ca.id = pt.client_account_id
     LEFT JOIN users requester ON requester.id = rf.requested_by_user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY rf.requested_at DESC`,
    params
  );

  return rows.map((row) => ({
    amount: row.amount,
    clientId: row.clientId || '',
    clientName: row.clientName || 'Unknown client',
    completedAt: row.completedAt || undefined,
    id: row.id,
    invoiceId: row.invoiceId || '',
    matterId: row.matterId || '',
    paymentId: row.paymentId,
    reasonText: row.reasonText,
    requestedAt: row.requestedAt.replace(' ', 'T'),
    requestedBy: row.requestedBy || 'System',
    status: row.status,
  }));
};

export const getWorkspace = async (options: { limit?: number; offset?: number } = {}) => {
  const startedAt = process.hrtime.bigint();
  const pagination = normalizePagination(options);
  const invoices = await fetchInvoices({ limit: pagination.limit, offset: pagination.offset });
  const total = await countInvoices({});
  const invoiceSettings = await getInvoiceSettings();
  const matters = await fetchMatterOptions({ limit: 100 });
  const invoiceIds = invoices.map((invoice) => invoice.id);
  const payments = invoiceIds.length ? await fetchPayments({ invoiceIds }) : [];
  const refunds = invoiceIds.length ? await listRefunds({ invoiceIds }) : [];
  const response = {
    invoices,
    invoiceSettings,
    matters,
    pagination: buildPaginationMeta(pagination, total),
    payments,
    refunds,
  };

  if (env.APP_ENV !== 'production') {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logEvent('info', 'admin.billing_workspace.loaded', {
      durationMs: Number(durationMs.toFixed(2)),
      invoiceCount: invoices.length,
      limit: pagination.limit,
      offset: pagination.offset,
      paymentCount: payments.length,
      queryCountEstimate: invoiceIds.length ? 8 : 6,
      refundCount: refunds.length,
    });
  }

  return response;
};

export const createInvoice = async (
  actor: AdminActor,
  payload: {
    amount: number;
    description: string;
    dueDate?: string;
    matterId: string;
  }
) =>
  withTransaction(async (connection) => {
    const matter = await getMatterBillingMeta(payload.matterId, connection);
    const invoicePublicId = createPublicId();
    const invoiceNumber = await allocateInvoiceNumber(connection);
    const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const issueDate = toDateOnly(new Date());
    const invoiceSettings = await getInvoiceSettings(connection);
    const dueDate = payload.dueDate || addDaysDateOnly(invoiceSettings.paymentTermsDays);
    const billingCurrency = await resolveBillingCurrency(matter.countryCode, connection);
    const lineFx = await convertBaseAmount(connection, payload.amount, billingCurrency);
    const invoiceFxSummary = summarizeFxSnapshots([lineFx]);
    const tax = await calculateInvoiceTax(
      {
        clientState: matter.state,
        lineAmount: lineFx.amount,
      },
      connection
    );

    const invoiceResult = await executeStatement(
      `INSERT INTO invoices (
         public_id,
         invoice_number,
         client_account_id,
         matter_id,
         matter_package_id,
         subscription_id,
         invoice_type_code,
         status_code,
         currency_code,
         issue_date,
         due_date,
         subtotal_amount,
         discount_amount,
         tax_amount,
         total_amount,
         original_currency_code,
         original_subtotal_amount,
         original_tax_amount,
         original_total_amount,
         exchange_rate,
         exchange_rate_date,
         exchange_rate_provider,
         fx_snapshot_json,
         amount_paid,
         amount_refunded,
         amount_due,
         created_by_user_id,
         created_at,
         updated_at,
         archived_at
       ) VALUES (?, ?, ?, ?, NULL, NULL, 'manual-admin', 'draft', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, NULL)`,
      [
        invoicePublicId,
        invoiceNumber,
        matter.clientAccountId,
        matter.matterDbId,
        lineFx.currencyCode,
        issueDate,
        dueDate,
        tax.subtotalDecimal,
        tax.taxDecimal,
        tax.totalDecimal,
        lineFx.originalCurrencyCode,
        lineFx.originalAmount,
        null,
        lineFx.originalAmount,
        invoiceFxSummary.exchangeRate,
        invoiceFxSummary.exchangeRateDate,
        invoiceFxSummary.exchangeRateProvider,
        invoiceFxSummary.snapshotJson,
        tax.totalDecimal,
        actor.userId,
        createdAt,
        createdAt,
      ],
      connection
    );

    await executeStatement(
      `INSERT INTO invoice_billing_snapshots (
         invoice_id,
         billing_name,
         billing_email,
         billing_phone,
         address_line1,
         address_line2,
         city,
         state,
         postal_code,
         country_code,
         gstin,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceResult.insertId,
        matter.billingName || matter.clientName,
        matter.email,
        matter.phone,
        matter.line1 || 'Address pending',
        matter.line2 || null,
        matter.city || '',
        matter.state || '',
        matter.postalCode || '',
        matter.countryCode || 'IN',
        matter.gstin || null,
        createdAt,
      ],
      connection
    );

    const lineResult = await executeStatement(
      `INSERT INTO invoice_lines (
         invoice_id,
         line_type_code,
         service_id,
         subscription_plan_id,
         description,
         quantity,
         unit_price,
         line_subtotal,
         discount_amount,
         taxable_amount,
         line_total,
         original_currency_code,
         original_unit_price,
         original_line_subtotal,
         original_taxable_amount,
         original_line_total,
         exchange_rate,
         exchange_rate_date,
         exchange_rate_provider,
         sort_order,
         created_at
       ) VALUES (?, 'manual-admin', NULL, NULL, ?, 1, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        invoiceResult.insertId,
        payload.description,
        tax.lineSubtotalDecimal,
        tax.lineSubtotalDecimal,
        tax.taxableDecimal,
        tax.lineTotalDecimal,
        lineFx.originalCurrencyCode,
        lineFx.originalAmount,
        lineFx.originalAmount,
        lineFx.originalAmount,
        lineFx.originalAmount,
        lineFx.exchangeRate,
        lineFx.exchangeRateDate,
        lineFx.exchangeRateProvider,
        createdAt,
      ],
      connection
    );

    await insertInvoiceLineTaxes(lineResult.insertId, tax, createdAt, connection);

    const templateSnapshot = await renderAndStoreInvoiceTemplateSnapshot(invoiceResult.insertId, connection);
    const pdfTemplateSnapshot = await applyInvoicePdfTemplateSnapshot(invoiceResult.insertId, connection);

    await executeStatement(
      `INSERT INTO invoice_installments (
         invoice_id,
         installment_no,
         due_date,
         amount_due,
         amount_paid,
         amount_remaining,
         status_code,
         paid_at,
         created_at
       ) VALUES (?, 1, ?, ?, 0, ?, 'pending', NULL, ?)`,
      [invoiceResult.insertId, dueDate, tax.totalDecimal, tax.totalDecimal, createdAt],
      connection
    );

    await executeStatement(
      `UPDATE matters m
       JOIN (
         SELECT
           matter_id,
           COALESCE(SUM(total_amount), 0) AS quotedTotal,
           COALESCE(SUM(amount_paid), 0) AS paidTotal,
           COALESCE(SUM(amount_due), 0) AS dueTotal
         FROM invoices
         WHERE matter_id = ?
           AND archived_at IS NULL
         GROUP BY matter_id
       ) totals ON totals.matter_id = m.id
       SET m.quoted_total_amount = totals.quotedTotal,
           m.paid_total_amount = totals.paidTotal,
           m.due_total_amount = totals.dueTotal,
           m.updated_at = UTC_TIMESTAMP(6),
           m.row_version = m.row_version + 1
       WHERE m.id = ?`,
      [matter.matterDbId, matter.matterDbId],
      connection
    );

    await touchMatterActivity(matter.matterDbId, connection);

    await createAuditEvent(
      {
        actionCode: 'invoice.created',
        actionLabel: 'Draft invoice created',
        actorRoleCode: actor.roleCodes[0] || 'billing_admin',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'description', newValue: payload.description },
          { fieldName: 'subtotal_amount', newValue: tax.subtotalDecimal },
          { fieldName: 'tax_amount', newValue: tax.taxDecimal },
          { fieldName: 'amount_due', newValue: tax.totalDecimal },
          { fieldName: 'tax_note', newValue: tax.note },
          { fieldName: 'due_date', newValue: dueDate },
          { fieldName: 'status_code', newValue: 'draft' },
        ],
        entityPk: invoiceResult.insertId,
        entityTableName: 'invoices',
        sourceModule: 'billing_workspace',
        summaryNewValue: `Created draft invoice ${invoiceNumber} for matter ${matter.matterNumber}`,
      },
      connection
    );

    await createAuditEvent(
      {
        actionCode: 'invoice.template_applied',
        actionLabel: 'Invoice template snapshot applied',
        actorRoleCode: actor.roleCodes[0] || 'billing_admin',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'template_public_id_snapshot', newValue: templateSnapshot.templateId },
          { fieldName: 'template_version_snapshot', newValue: templateSnapshot.templateVersion },
        ],
        entityPk: invoiceResult.insertId,
        entityTableName: 'invoices',
        sourceModule: 'billing_workspace',
        summaryNewValue: `Applied invoice template to ${invoiceNumber}`,
      },
      connection
    );

    if (pdfTemplateSnapshot.templateId) {
      await createAuditEvent(
        {
          actionCode: 'invoice.pdf_template_applied',
          actionLabel: 'Invoice PDF letterhead snapshot applied',
          actorRoleCode: actor.roleCodes[0] || 'billing_admin',
          actorUserId: actor.userId,
          changes: [
            { fieldName: 'pdf_template_public_id_snapshot', newValue: pdfTemplateSnapshot.templateId },
            { fieldName: 'pdf_template_name_snapshot', newValue: pdfTemplateSnapshot.templateName },
          ],
          entityPk: invoiceResult.insertId,
          entityTableName: 'invoices',
          sourceModule: 'billing_workspace',
          summaryNewValue: `Applied invoice PDF letterhead to ${invoiceNumber}`,
        },
        connection
      );
    }

    return {
      invoiceId: invoicePublicId,
      status: 'created' as const,
    };
  });

export const sendInvoice = async (actor: AdminActor, invoiceId: string) =>
  withTransaction(async (connection) => {
    const invoice = await getInvoiceDispatchMeta(invoiceId, connection);

    if (invoice.statusCode === 'paid' || invoice.statusCode === 'void' || invoice.statusCode === 'refunded') {
      throw badRequest(
        'invoice_send_not_allowed',
        'Only draft or outstanding invoices can be sent to the client.'
      );
    }

    const isInitialSend = invoice.statusCode === 'draft';

    if (isInitialSend) {
      await executeStatement(
        `UPDATE invoices
         SET status_code = 'sent',
             updated_at = UTC_TIMESTAMP(6),
             row_version = row_version + 1
         WHERE id = ?`,
        [invoice.invoiceDbId],
        connection
      );
    }

    if (invoice.matterDbId) {
      await executeStatement(
        `UPDATE matters
         SET operational_status_code = CASE
               WHEN operational_status_code IN ('paid', 'completed', 'archived')
                 THEN operational_status_code
               ELSE 'awaiting-payment'
             END,
             last_activity_at = UTC_TIMESTAMP(6),
             updated_at = UTC_TIMESTAMP(6),
             row_version = row_version + 1
         WHERE id = ?`,
        [invoice.matterDbId],
        connection
      );
    }

    await ensureInvoiceTemplateSnapshot(invoice.invoiceDbId, connection);
    const emailDelivery = await sendInvoiceEmailIfConfigured(actor, invoice.invoiceDbId, connection);

    await createClientNotifications(
      {
        bodyText: isInitialSend
          ? `Invoice ${invoice.invoiceNumber} has been issued for ${formatInvoiceMoney(invoice.totalAmount, invoice.currencyCode)}.`
          : `Reminder: invoice ${invoice.invoiceNumber} for ${formatInvoiceMoney(invoice.totalAmount, invoice.currencyCode)} is still outstanding.`,
        clientAccountId: invoice.clientAccountId,
        invoiceId: invoice.invoiceDbId,
        matterId: invoice.matterDbId,
        notificationTypeCode: isInitialSend ? 'invoice_generated' : 'payment_reminder',
        priorityCode: 'normal',
        suppressExternalDelivery: true,
        title: isInitialSend ? 'Invoice ready for payment' : 'Payment reminder',
      },
      connection
    );

    await createAuditEvent(
      {
        actionCode: isInitialSend ? 'invoice.issued' : 'invoice.reminder_sent',
        actionLabel: isInitialSend ? 'Invoice issued to client' : 'Invoice reminder sent',
        actorRoleCode: actor.roleCodes[0] || 'billing_admin',
        actorUserId: actor.userId,
        changes: isInitialSend
          ? [{ fieldName: 'status_code', oldValue: 'draft', newValue: 'sent' }]
          : [{ fieldName: 'reminder_sent', newValue: true }],
        entityPk: invoice.invoiceDbId,
        entityTableName: 'invoices',
        sourceModule: 'billing_workspace',
        summaryNewValue: isInitialSend
          ? `Sent invoice ${invoice.invoiceNumber}`
          : `Sent reminder for invoice ${invoice.invoiceNumber}`,
      },
      connection
    );

    return {
      emailDeliveryStatus: emailDelivery.status,
      invoiceId: invoice.invoiceId,
      status: isInitialSend ? ('sent' as const) : ('reminder_sent' as const),
    };
  });

export const recordManualPayment = async (
  actor: AdminActor,
  payload: {
    amount: number | string;
    invoiceId: string;
    notes?: string;
    paymentDate: string;
    paymentMethod: 'bank-transfer' | 'cash' | 'cheque' | 'online';
    referenceNumber?: string;
  }
) =>
  withTransaction(async (connection) => {
    if (!isDateOnly(payload.paymentDate)) {
      throw badRequest('invalid_payment_date', 'Payment date must use YYYY-MM-DD format.');
    }

    const invoice = await getInvoicePaymentMeta(payload.invoiceId, connection);
    const paymentAmount = normalizeMoney(payload.amount);
    const amountDueMinor = toMinorUnits(invoice.amountDue);

    if (invoice.statusCode === 'draft') {
      throw badRequest('invoice_payment_not_allowed', 'Issue the invoice before recording payment.');
    }

    if (invoice.statusCode === 'void') {
      throw badRequest('invoice_payment_not_allowed', 'Void invoices cannot receive payments.');
    }

    if (invoice.statusCode === 'paid' || amountDueMinor <= 0) {
      throw badRequest('invoice_already_paid', 'This invoice is already paid.');
    }

    if (paymentAmount.minorUnits > amountDueMinor) {
      throw badRequest(
        'payment_exceeds_invoice_balance',
        `Payment exceeds the remaining invoice balance of ${minorToDecimal(amountDueMinor)}.`
      );
    }

    const providedReference = payload.referenceNumber?.trim();

    if (providedReference) {
      const duplicateReference = firstRow(
        await queryRows<DuplicatePaymentReferenceRow>(
          `SELECT public_id AS paymentId
           FROM payment_transactions
           WHERE client_account_id = ?
             AND LOWER(TRIM(gateway_payment_ref)) = LOWER(TRIM(?))
             AND status_code NOT IN ('failed', 'cancelled')
           LIMIT 1`,
          [invoice.clientAccountId, providedReference],
          connection
        )
      );

      if (duplicateReference) {
        throw badRequest(
          'duplicate_payment_reference',
          'A payment with this reference number is already recorded for this client.'
        );
      }
    }

    const paymentPublicId = createPublicId();
    const capturedAt = `${payload.paymentDate} ${new Date().toISOString().slice(11, 19)}`;
    const referenceNumber = providedReference || `MANUAL-${paymentPublicId.slice(-10)}`;
    const manualPaymentMethodId = await resolveManualPaymentMethodId(
      {
        actorUserId: actor.userId,
        clientAccountId: invoice.clientAccountId,
        paymentMethod: payload.paymentMethod,
      },
      connection
    );

    const paymentResult = await executeStatement(
      `INSERT INTO payment_transactions (
         public_id,
         client_account_id,
         payment_method_id,
         gateway_provider_code,
         gateway_order_ref,
         gateway_payment_ref,
         status_code,
         currency_code,
         gross_amount,
         gateway_fee_amount,
         net_amount,
         failure_reason,
         initiated_at,
         authorized_at,
         captured_at,
         failed_at,
         created_by_user_id,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, 'manual', NULL, ?, 'captured', ?, ?, 0, ?, NULL,
         ?, ?, ?, NULL, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
       )`,
      [
        paymentPublicId,
        invoice.clientAccountId,
        manualPaymentMethodId,
        referenceNumber,
        invoice.currencyCode || 'USD',
        paymentAmount.decimal,
        paymentAmount.decimal,
        capturedAt,
        capturedAt,
        capturedAt,
        actor.userId,
      ],
      connection
    );

    const allocationResult = await executeStatement(
      `INSERT INTO payment_allocations (
         payment_transaction_id,
         invoice_id,
         invoice_installment_id,
         amount_applied,
         created_at
       ) VALUES (?, ?, NULL, ?, UTC_TIMESTAMP(6))`,
      [paymentResult.insertId, invoice.invoiceDbId, paymentAmount.decimal],
      connection
    );

    let remainingToApply = paymentAmount.minorUnits;
    const installments = await queryRows<InstallmentAllocationRow>(
      `SELECT
         id AS installmentDbId,
         amount_remaining AS amountRemaining
       FROM invoice_installments
       WHERE invoice_id = ?
         AND amount_remaining > 0
       ORDER BY installment_no ASC
       FOR UPDATE`,
      [invoice.invoiceDbId],
      connection
    );

    for (const installment of installments) {
      if (remainingToApply <= 0) {
        break;
      }

      const installmentRemainingMinor = toMinorUnits(installment.amountRemaining);
      const amountForInstallmentMinor = Math.min(remainingToApply, installmentRemainingMinor);
      const nextRemainingMinor = installmentRemainingMinor - amountForInstallmentMinor;
      const nextInstallmentStatus = nextRemainingMinor === 0 ? 'paid' : 'pending';

      await executeStatement(
        `UPDATE invoice_installments
         SET amount_paid = amount_paid + ?,
             amount_remaining = ?,
             status_code = ?,
             paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END
         WHERE id = ?`,
        [
          minorToDecimal(amountForInstallmentMinor),
          minorToDecimal(nextRemainingMinor),
          nextInstallmentStatus,
          nextInstallmentStatus,
          capturedAt,
          installment.installmentDbId,
        ],
        connection
      );

      remainingToApply -= amountForInstallmentMinor;
    }

    const nextPaidMinor = toMinorUnits(invoice.amountPaid) + paymentAmount.minorUnits;
    const nextDueMinor = Math.max(
      toMinorUnits(invoice.totalAmount) - toMinorUnits(invoice.amountRefunded) - nextPaidMinor,
      0
    );
    const nextInvoiceStatus =
      nextDueMinor === 0 ? 'paid' : invoice.statusCode === 'overdue' ? 'overdue' : 'pending';

    await executeStatement(
      `UPDATE invoices
       SET amount_paid = ?,
           amount_due = ?,
           status_code = ?,
           updated_at = UTC_TIMESTAMP(6),
           row_version = row_version + 1
       WHERE id = ?`,
      [
        minorToDecimal(nextPaidMinor),
        minorToDecimal(nextDueMinor),
        nextInvoiceStatus,
        invoice.invoiceDbId,
      ],
      connection
    );

    if (invoice.matterDbId) {
      await executeStatement(
        `UPDATE matters m
         JOIN (
           SELECT
             matter_id,
             COALESCE(SUM(amount_paid), 0) AS paidTotal,
             COALESCE(SUM(amount_due), 0) AS dueTotal
           FROM invoices
           WHERE matter_id = ?
             AND archived_at IS NULL
           GROUP BY matter_id
         ) totals ON totals.matter_id = m.id
         SET m.paid_total_amount = totals.paidTotal,
             m.due_total_amount = totals.dueTotal,
             m.operational_status_code = CASE
               WHEN m.operational_status_code IN ('completed', 'archived') THEN m.operational_status_code
               WHEN totals.dueTotal <= 0 THEN 'paid'
               ELSE 'awaiting-payment'
             END,
             m.last_activity_at = UTC_TIMESTAMP(6),
             m.updated_at = UTC_TIMESTAMP(6),
             m.row_version = m.row_version + 1
         WHERE m.id = ?`,
        [invoice.matterDbId, invoice.matterDbId],
        connection
      );
    }

    await createAuditEvent(
      {
        actionCode: 'payment.recorded',
        actionLabel: 'Manual payment recorded',
        actorRoleCode: actor.roleCodes[0] || 'billing_admin',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'amount', newValue: paymentAmount.decimal },
          { fieldName: 'payment_method', newValue: payload.paymentMethod },
          { fieldName: 'payment_date', newValue: payload.paymentDate },
          { fieldName: 'reference_number', newValue: referenceNumber },
          { fieldName: 'notes', newValue: payload.notes?.trim() || null },
        ],
        entityPk: paymentResult.insertId,
        entityTableName: 'payment_transactions',
        sourceModule: 'billing_workspace',
        summaryNewValue: `Recorded ${paymentAmount.decimal} against invoice ${invoice.invoiceNumber}`,
      },
      connection
    );

    await createAuditEvent(
      {
        actionCode: 'payment.allocated',
        actionLabel: 'Payment allocated to invoice',
        actorRoleCode: actor.roleCodes[0] || 'billing_admin',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'invoice_id', newValue: invoice.invoiceId },
          { fieldName: 'amount_applied', newValue: paymentAmount.decimal },
        ],
        entityPk: allocationResult.insertId,
        entityTableName: 'payment_allocations',
        sourceModule: 'billing_workspace',
        summaryNewValue: `Allocated ${paymentAmount.decimal} to invoice ${invoice.invoiceNumber}`,
      },
      connection
    );

    if (nextInvoiceStatus !== invoice.statusCode) {
      await createAuditEvent(
        {
          actionCode: 'invoice.status_changed',
          actionLabel: 'Invoice status changed',
          actorRoleCode: actor.roleCodes[0] || 'billing_admin',
          actorUserId: actor.userId,
          changes: [{ fieldName: 'status_code', oldValue: invoice.statusCode, newValue: nextInvoiceStatus }],
          entityPk: invoice.invoiceDbId,
          entityTableName: 'invoices',
          sourceModule: 'billing_workspace',
          summaryOldValue: invoice.statusCode,
          summaryNewValue: nextInvoiceStatus,
        },
        connection
      );
    }

    await createClientNotifications(
      {
        bodyText: `Payment of ${formatInvoiceMoney(Number(paymentAmount.decimal), invoice.currencyCode || 'USD')} has been recorded against invoice ${invoice.invoiceNumber}.`,
        clientAccountId: invoice.clientAccountId,
        invoiceId: invoice.invoiceDbId,
        matterId: invoice.matterDbId,
        notificationTypeCode: 'payment_reminder',
        priorityCode: 'normal',
        title: 'Payment recorded',
      },
      connection
    );

    if (nextInvoiceStatus === 'paid') {
      await createClientNotifications(
        {
          bodyText: `Invoice ${invoice.invoiceNumber} is now marked paid.`,
          clientAccountId: invoice.clientAccountId,
          invoiceId: invoice.invoiceDbId,
          matterId: invoice.matterDbId,
          notificationTypeCode: 'payment_reminder',
          priorityCode: 'normal',
          title: 'Invoice paid',
        },
        connection
      );
    }

    return {
      amountDue: Number(minorToDecimal(nextDueMinor)),
      amountPaid: Number(minorToDecimal(nextPaidMinor)),
      invoiceId: invoice.invoiceId,
      invoiceStatus: nextInvoiceStatus,
      paymentId: paymentPublicId,
      status: 'recorded' as const,
    };
  });

export const createRefund = async (
  actor: AdminActor,
  payload: {
    amount: number;
    invoiceId?: string;
    paymentId: string;
    reasonText: string;
  }
) => {
  return withTransaction(async (connection) => {
    const payment = firstRow(
      await queryRows<PaymentSummaryRow>(
        `SELECT
           pt.id,
           pt.client_account_id AS clientAccountId,
           pt.currency_code AS currencyCode,
           pt.gross_amount AS grossAmount,
           pt.status_code AS statusCode
         FROM payment_transactions pt
         WHERE pt.public_id = ?
         LIMIT 1
         FOR UPDATE`,
        [payload.paymentId],
        connection
      )
    );

    if (!payment) {
      throw notFound('payment_not_found', 'Payment not found.');
    }

    const paymentInvoiceSummary = firstRow(
      await queryRows<PaymentInvoiceSummaryRow>(
        `SELECT
           MAX(pa.invoice_id) AS invoiceId,
           MAX(inv.matter_id) AS matterId
         FROM payment_allocations pa
         LEFT JOIN invoices inv ON inv.id = pa.invoice_id
         WHERE pa.payment_transaction_id = ?`,
        [payment.id],
        connection
      )
    );

    const invoice = payload.invoiceId
      ? await resolveInvoiceByPublicId(payload.invoiceId, connection)
      : paymentInvoiceSummary?.invoiceId
        ? { id: paymentInvoiceSummary.invoiceId }
        : null;

    const refundedTotalRows = await queryRows<PaymentRefundedTotalRow>(
      `SELECT
         COALESCE(SUM(rf.amount), 0) AS refundedAmount
       FROM refunds rf
       WHERE rf.payment_transaction_id = ?`,
      [payment.id],
      connection
    );

    const refundAmount = normalizeMoney(payload.amount);
    const refundedAmount = refundedTotalRows[0]?.refundedAmount ?? 0;
    const grossMinor = toMinorUnits(payment.grossAmount);
    const refundedMinor = toMinorUnits(refundedAmount);
    const availableMinor = Math.max(grossMinor - refundedMinor, 0);

    if (refundAmount.minorUnits > availableMinor) {
      throw badRequest(
        'refund_amount_exceeds_available',
        `Refund exceeds the remaining refundable amount of ${minorToDecimal(availableMinor)}.`
      );
    }

    const refundResult = await executeStatement(
      `INSERT INTO refunds (
         public_id,
         payment_transaction_id,
         invoice_id,
         amount,
         refund_status_code,
         reason_text,
         gateway_refund_ref,
         requested_by_user_id,
         approved_by_user_id,
         requested_at,
         completed_at,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, 'completed', ?, NULL, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6),
         UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
       )`,
      [
        createPublicId(),
        payment.id,
        invoice?.id || null,
        refundAmount.decimal,
        payload.reasonText,
        actor.userId,
        actor.userId,
      ],
      connection
    );

    const totalRefundedMinor = refundedMinor + refundAmount.minorUnits;
    const nextPaymentStatus =
      totalRefundedMinor >= grossMinor ? 'refunded' : 'partially-refunded';

    await executeStatement(
      `UPDATE payment_transactions
       SET status_code = ?, updated_at = UTC_TIMESTAMP(6), row_version = row_version + 1
       WHERE id = ?`,
      [nextPaymentStatus, payment.id],
      connection
    );

    if (invoice?.id) {
      await executeStatement(
        `UPDATE invoices
         SET amount_refunded = amount_refunded + ?,
             status_code = CASE
               WHEN amount_refunded + ? >= total_amount THEN 'refunded'
               ELSE status_code
             END,
             updated_at = UTC_TIMESTAMP(6),
             row_version = row_version + 1
         WHERE id = ?`,
        [refundAmount.decimal, refundAmount.decimal, invoice.id],
        connection
      );
    }

    if (paymentInvoiceSummary?.matterId) {
      await touchMatterActivity(paymentInvoiceSummary.matterId, connection);
    }

    await createAuditEvent(
      {
        actionCode: 'refund.recorded',
        actionLabel: 'Refund recorded',
        actorRoleCode: actor.roleCodes[0] || 'billing_admin',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'amount', newValue: Number(refundAmount.decimal) },
          { fieldName: 'reason_text', newValue: payload.reasonText },
          { fieldName: 'payment_status', oldValue: payment.statusCode, newValue: nextPaymentStatus },
        ],
        entityPk: refundResult.insertId,
        entityTableName: 'refunds',
        sourceModule: 'billing_workspace',
        summaryNewValue: `Refunded ${refundAmount.decimal}`,
      },
      connection
    );

    await createClientNotifications(
      {
        bodyText: `A refund of ${formatInvoiceMoney(Number(refundAmount.decimal), payment.currencyCode || 'USD')} has been initiated against your payment.`,
        clientAccountId: payment.clientAccountId,
        invoiceId: invoice?.id || null,
        matterId: paymentInvoiceSummary?.matterId || null,
        notificationTypeCode: 'payment_reminder',
        priorityCode: 'normal',
        title: 'Refund issued',
      },
      connection
    );

    return { status: 'created' as const };
  });
};
