import type { RowDataPacket } from 'mysql2/promise';
import { executeStatement, queryRows, type QueryExecutor } from '../../lib/mysql.js';
import { getInvoiceSettings } from '../settings/invoiceSettings.js';

type InvoiceTemplateRow = RowDataPacket & {
  body: string;
  id: string;
  subject: string | null;
  version: number;
};

type InvoiceSnapshotRow = RowDataPacket & {
  businessAddress: string | null;
  businessEmail: string | null;
  businessGstin: string | null;
  businessName: string | null;
  businessPhone: string | null;
  businessState: string | null;
  businessWebsite: string | null;
  body: string | null;
  footer: string | null;
  paymentInstructions: string | null;
  subject: string | null;
  templateId: string | null;
  templateVersion: number | null;
  terms: string | null;
};

type InvoiceContextRow = RowDataPacket & {
  amountDue: number;
  amountPaid: number;
  businessAddress: string | null;
  businessEmail: string | null;
  billingDisplayName: string;
  businessLegalName: string;
  businessPhone: string | null;
  businessState: string | null;
  businessWebsite: string | null;
  clientName: string;
  currencyCode: string;
  dueDate: string;
  gstin: string | null;
  invoiceFooter: string | null;
  invoiceTerms: string | null;
  invoiceNumber: string;
  issueDate: string;
  matterTitle: string | null;
  paymentInstructions: string | null;
  paymentTermsDays: number;
  sacCode: string | null;
  statusCode: string;
  subtotalAmount: number;
  taxAmount: number;
  taxMode: string;
  totalAmount: number;
};

type InvoiceLineRow = RowDataPacket & {
  description: string;
  lineTotal: number;
  quantity: number;
  unitPrice: number;
};

type InvoiceTaxSummaryRow = RowDataPacket & {
  amount: number;
  code: string;
  name: string;
  percent: number;
};

export type InvoiceTemplateSnapshot = {
  body: string;
  footer: string;
  subject: string;
  templateId: string | null;
  templateVersion: number | null;
  terms: string;
};

const INVOICE_FALLBACK_SUBJECT = 'Invoice {{invoiceNumber}} from Global LMG';
const INVOICE_FALLBACK_BODY =
  'Invoice {{invoiceNumber}} has been issued for {{clientName}} regarding {{matterTitle}}.\n\nLine items:\n{{lineItems}}\n\nSubtotal: {{subtotal}}\nTax: {{taxTotal}}\nTotal: {{total}}\nAmount due: {{amountDue}}';
const INVOICE_FALLBACK_FOOTER =
  'Global LMG provides intermediary legal consultancy, coordination, and support services. This invoice is not for legal representation by Global LMG.';

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const firstRow = <TRow>(rows: TRow[]) => rows[0] || null;

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));

export const formatInvoiceCurrency = (amount: number, currencyCode: string) => {
  const normalizedCurrency = /^[A-Z]{3}$/.test(String(currencyCode || '').trim().toUpperCase())
    ? String(currencyCode || '').trim().toUpperCase()
    : 'USD';
  const formattedAmount = Number(amount || 0).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });

  return `${normalizedCurrency} ${formattedAmount}`;
};

const renderTemplate = (template: string, context: Record<string, string>) =>
  template.replace(PLACEHOLDER_PATTERN, (_placeholder, key: string) => context[key] ?? '');

const loadSelectedInvoiceTemplate = async (executor: QueryExecutor): Promise<InvoiceTemplateRow | null> => {
  const settings = await getInvoiceSettings(executor);

  if (settings.defaultInvoiceTemplateId) {
    const preferred = firstRow(
      await queryRows<InvoiceTemplateRow>(
        `SELECT
           public_id AS id,
           subject,
           body_text AS body,
           version
         FROM admin_templates
         WHERE public_id = ?
           AND template_type_code = 'invoice'
           AND is_active = 1
           AND archived_at IS NULL
         LIMIT 1`,
        [settings.defaultInvoiceTemplateId],
        executor
      )
    );

    if (preferred) {
      return preferred;
    }
  }

  return firstRow(
    await queryRows<InvoiceTemplateRow>(
      `SELECT
         public_id AS id,
         subject,
         body_text AS body,
         version
       FROM admin_templates
       WHERE template_type_code = 'invoice'
         AND is_active = 1
         AND archived_at IS NULL
       ORDER BY is_default DESC, updated_at DESC, id DESC
       LIMIT 1`,
      [],
      executor
    )
  );
};

const loadExistingSnapshot = async (invoiceDbId: number, executor: QueryExecutor) =>
  firstRow(
    await queryRows<InvoiceSnapshotRow>(
      `SELECT
         template_public_id_snapshot AS templateId,
         template_version_snapshot AS templateVersion,
         rendered_subject_snapshot AS subject,
         rendered_body_snapshot AS body,
         rendered_terms_snapshot AS terms,
         rendered_footer_snapshot AS footer,
         business_name_snapshot AS businessName,
         business_address_snapshot AS businessAddress,
         business_phone_snapshot AS businessPhone,
         business_email_snapshot AS businessEmail,
         business_website_snapshot AS businessWebsite,
         business_gstin_snapshot AS businessGstin,
         business_state_snapshot AS businessState,
         payment_instructions_snapshot AS paymentInstructions
       FROM invoices
       WHERE id = ?
       LIMIT 1`,
      [invoiceDbId],
      executor
    )
  );

const loadTemplateContext = async (invoiceDbId: number, executor: QueryExecutor) => {
  const row = firstRow(
    await queryRows<InvoiceContextRow>(
      `SELECT
         inv.invoice_number AS invoiceNumber,
         ca.display_name AS clientName,
         matter.title AS matterTitle,
         inv.status_code AS statusCode,
         inv.currency_code AS currencyCode,
         inv.issue_date AS issueDate,
         inv.due_date AS dueDate,
         inv.subtotal_amount AS subtotalAmount,
         inv.tax_amount AS taxAmount,
         inv.total_amount AS totalAmount,
         inv.amount_paid AS amountPaid,
         inv.amount_due AS amountDue,
         settings.business_legal_name AS businessLegalName,
         settings.billing_display_name AS billingDisplayName,
         settings.business_address AS businessAddress,
         settings.business_phone AS businessPhone,
         settings.business_email AS businessEmail,
         settings.business_website AS businessWebsite,
         settings.business_state AS businessState,
         settings.default_sac_code AS sacCode,
         settings.gstin,
         settings.invoice_footer AS invoiceFooter,
         settings.invoice_terms AS invoiceTerms,
         settings.payment_instructions AS paymentInstructions,
         settings.tax_mode_code AS taxMode,
         settings.payment_terms_days AS paymentTermsDays
       FROM invoices inv
       INNER JOIN client_accounts ca ON ca.id = inv.client_account_id
       LEFT JOIN matters matter ON matter.id = inv.matter_id
       CROSS JOIN invoice_settings settings
       WHERE inv.id = ?
       LIMIT 1`,
      [invoiceDbId],
      executor
    )
  );

  if (!row) {
    throw new Error('Invoice not found while rendering template.');
  }

  const lines = await queryRows<InvoiceLineRow>(
    `SELECT
       description,
       quantity,
       unit_price AS unitPrice,
       line_total AS lineTotal
     FROM invoice_lines
     WHERE invoice_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [invoiceDbId],
    executor
  );

  const taxes = await queryRows<InvoiceTaxSummaryRow>(
    `SELECT
       tax_code_snapshot AS code,
       tax_name_snapshot AS name,
       tax_percent_snapshot AS percent,
       COALESCE(SUM(tax_amount), 0) AS amount
     FROM invoice_line_taxes ilt
     INNER JOIN invoice_lines il ON il.id = ilt.invoice_line_id
     WHERE il.invoice_id = ?
     GROUP BY tax_code_snapshot, tax_name_snapshot, tax_percent_snapshot
     ORDER BY MIN(ilt.sort_order), tax_code_snapshot`,
    [invoiceDbId],
    executor
  );

  return { row, lines, taxes };
};

export const renderAndStoreInvoiceTemplateSnapshot = async (
  invoiceDbId: number,
  executor: QueryExecutor
): Promise<InvoiceTemplateSnapshot> => {
  const selectedTemplate = await loadSelectedInvoiceTemplate(executor);
  const { lines, row, taxes } = await loadTemplateContext(invoiceDbId, executor);
  const paymentTerms =
    row.invoiceTerms ||
    (Number(row.paymentTermsDays || 0) > 0
      ? `Payment due within ${Number(row.paymentTermsDays)} day${Number(row.paymentTermsDays) === 1 ? '' : 's'}.`
      : `Payment due by ${formatDate(row.dueDate)}.`);
  const footer = row.invoiceFooter || INVOICE_FALLBACK_FOOTER;
  const lineItems = lines.length
    ? lines
        .map(
          (line) =>
            `- ${line.description} (${Number(line.quantity).toFixed(2)} x ${formatInvoiceCurrency(
              Number(line.unitPrice),
              row.currencyCode
            )}): ${formatInvoiceCurrency(Number(line.lineTotal), row.currencyCode)}`
        )
        .join('\n')
    : 'No line items recorded.';
  const taxBreakdown = taxes.length
    ? taxes
        .map(
          (tax) =>
            `${tax.name} ${Number(tax.percent).toFixed(2)}%: ${formatInvoiceCurrency(Number(tax.amount), row.currencyCode)}`
        )
        .join('\n')
    : 'No tax applied.';
  const context = {
    amountDue: formatInvoiceCurrency(row.amountDue, row.currencyCode),
    amountPaid: formatInvoiceCurrency(row.amountPaid, row.currencyCode),
    businessAddress: row.businessAddress || 'Not configured',
    businessEmail: row.businessEmail || 'Not configured',
    businessLegalName: row.businessLegalName || 'Global LMG',
    businessPhone: row.businessPhone || 'Not configured',
    businessWebsite: row.businessWebsite || 'Not configured',
    clientName: row.clientName,
    dueDate: formatDate(row.dueDate),
    footer,
    footerNote: footer,
    gstin: row.gstin || '',
    invoiceNumber: row.invoiceNumber,
    issueDate: formatDate(row.issueDate),
    lineItems,
    matterTitle: row.matterTitle || 'General services',
    paymentInstructions: row.paymentInstructions || '',
    paymentTerms,
    platformName: row.billingDisplayName || row.businessLegalName || 'Global LMG',
    sacCode: row.sacCode || 'Not configured',
    subtotal: formatInvoiceCurrency(row.subtotalAmount, row.currencyCode),
    taxBreakdown,
    taxMode: row.taxMode.replace(/_/g, ' '),
    taxTotal: formatInvoiceCurrency(row.taxAmount, row.currencyCode),
    total: formatInvoiceCurrency(row.totalAmount, row.currencyCode),
    totalAmount: formatInvoiceCurrency(row.totalAmount, row.currencyCode),
  };
  const subject = renderTemplate(
    selectedTemplate?.subject || INVOICE_FALLBACK_SUBJECT,
    context
  ).slice(0, 255);
  const body = renderTemplate(selectedTemplate?.body || INVOICE_FALLBACK_BODY, context);
  const terms = paymentTerms;

  await executeStatement(
    `UPDATE invoices
     SET template_public_id_snapshot = ?,
         template_version_snapshot = ?,
         rendered_subject_snapshot = ?,
         rendered_body_snapshot = ?,
         rendered_terms_snapshot = ?,
         rendered_footer_snapshot = ?,
         business_name_snapshot = ?,
         business_address_snapshot = ?,
         business_phone_snapshot = ?,
         business_email_snapshot = ?,
         business_website_snapshot = ?,
         business_gstin_snapshot = ?,
         business_state_snapshot = ?,
         payment_instructions_snapshot = ?,
         updated_at = UTC_TIMESTAMP(6),
         row_version = row_version + 1
     WHERE id = ?`,
    [
      selectedTemplate?.id || null,
      selectedTemplate?.version || null,
      subject,
      body,
      terms,
      footer,
      row.businessLegalName || row.billingDisplayName || 'Global LMG',
      row.businessAddress || null,
      row.businessPhone || null,
      row.businessEmail || null,
      row.businessWebsite || null,
      row.gstin || null,
      row.businessState || null,
      row.paymentInstructions || null,
      invoiceDbId,
    ],
    executor
  );

  return {
    body,
    footer,
    subject,
    templateId: selectedTemplate?.id || null,
    templateVersion: selectedTemplate?.version || null,
    terms,
  };
};

export const ensureInvoiceTemplateSnapshot = async (
  invoiceDbId: number,
  executor: QueryExecutor
): Promise<InvoiceTemplateSnapshot> => {
  const snapshot = await loadExistingSnapshot(invoiceDbId, executor);

  if (snapshot?.subject && snapshot.body) {
    return {
      body: snapshot.body,
      footer: snapshot.footer || INVOICE_FALLBACK_FOOTER,
      subject: snapshot.subject,
      templateId: snapshot.templateId,
      templateVersion: snapshot.templateVersion,
      terms: snapshot.terms || '',
    };
  }

  return renderAndStoreInvoiceTemplateSnapshot(invoiceDbId, executor);
};
