import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { selectAll, selectOne } from '../../lib/mysqlUtils.js';

type InvoiceTemplateRow = RowDataPacket & {
  body: string;
  id: string;
  subject: string | null;
  version: number;
};

type InvoiceContextRow = RowDataPacket & {
  amountDue: number;
  amountPaid: number;
  billingDisplayName: string;
  businessAddress: string | null;
  businessEmail: string | null;
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
  name: string;
  percent: number;
};

const FALLBACK_SUBJECT = 'Invoice {{invoiceNumber}} from Global LMG';
const FALLBACK_BODY =
  'Invoice {{invoiceNumber}} has been issued for {{clientName}} regarding {{matterTitle}}.\n\nLine items:\n{{lineItems}}\n\nSubtotal: {{subtotal}}\nTax: {{taxTotal}}\nTotal: {{total}}\nAmount due: {{amountDue}}';
const FALLBACK_FOOTER =
  'Global LMG provides intermediary legal consultancy, coordination, and support services. This invoice is not for legal representation by Global LMG.';
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));

const formatCurrency = (amount: number, currencyCode: string) => {
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

const loadTemplate = async (connection: PoolConnection) => {
  const preferred = await selectOne<InvoiceTemplateRow>(
    connection,
    `SELECT
       tpl.public_id AS id,
       tpl.subject,
       tpl.body_text AS body,
       tpl.version
     FROM invoice_settings settings
     INNER JOIN admin_templates tpl
       ON tpl.public_id = settings.default_invoice_template_public_id
      AND tpl.template_type_code = 'invoice'
      AND tpl.is_active = 1
      AND tpl.archived_at IS NULL
     WHERE settings.id = 1
     LIMIT 1`
  );

  if (preferred) {
    return preferred;
  }

  return selectOne<InvoiceTemplateRow>(
    connection,
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
     LIMIT 1`
  );
};

export const renderAndStoreInvoiceTemplateSnapshot = async (
  connection: PoolConnection,
  invoiceDbId: number
) => {
  const template = await loadTemplate(connection);
  const row = await selectOne<InvoiceContextRow>(
    connection,
    `SELECT
       inv.invoice_number AS invoiceNumber,
       ca.display_name AS clientName,
       matter.title AS matterTitle,
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
    [invoiceDbId]
  );

  if (!row) {
    return;
  }

  const lines = await selectAll<InvoiceLineRow>(
    connection,
    `SELECT description, quantity, unit_price AS unitPrice, line_total AS lineTotal
     FROM invoice_lines
     WHERE invoice_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [invoiceDbId]
  );
  const taxes = await selectAll<InvoiceTaxSummaryRow>(
    connection,
    `SELECT
       tax_name_snapshot AS name,
       tax_percent_snapshot AS percent,
       COALESCE(SUM(tax_amount), 0) AS amount
     FROM invoice_line_taxes ilt
     INNER JOIN invoice_lines il ON il.id = ilt.invoice_line_id
     WHERE il.invoice_id = ?
     GROUP BY tax_name_snapshot, tax_percent_snapshot
     ORDER BY MIN(ilt.sort_order), tax_name_snapshot`,
    [invoiceDbId]
  );
  const footer = row.invoiceFooter || FALLBACK_FOOTER;
  const terms =
    row.invoiceTerms ||
    (Number(row.paymentTermsDays || 0) > 0
      ? `Payment due within ${Number(row.paymentTermsDays)} day${Number(row.paymentTermsDays) === 1 ? '' : 's'}.`
      : `Payment due by ${formatDate(row.dueDate)}.`);
  const lineItems = lines.length
    ? lines
        .map(
          (line) =>
            `- ${line.description} (${Number(line.quantity).toFixed(2)} x ${formatCurrency(
              Number(line.unitPrice),
              row.currencyCode
            )}): ${formatCurrency(Number(line.lineTotal), row.currencyCode)}`
        )
        .join('\n')
    : 'No line items recorded.';
  const taxBreakdown = taxes.length
    ? taxes
        .map((tax) => `${tax.name} ${Number(tax.percent).toFixed(2)}%: ${formatCurrency(Number(tax.amount), row.currencyCode)}`)
        .join('\n')
    : 'No tax applied.';
  const context = {
    amountDue: formatCurrency(row.amountDue, row.currencyCode),
    amountPaid: formatCurrency(row.amountPaid, row.currencyCode),
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
    paymentTerms: terms,
    platformName: row.billingDisplayName || row.businessLegalName || 'Global LMG',
    sacCode: row.sacCode || 'Not configured',
    subtotal: formatCurrency(row.subtotalAmount, row.currencyCode),
    taxBreakdown,
    taxMode: row.taxMode.replace(/_/g, ' '),
    taxTotal: formatCurrency(row.taxAmount, row.currencyCode),
    total: formatCurrency(row.totalAmount, row.currencyCode),
    totalAmount: formatCurrency(row.totalAmount, row.currencyCode),
  };

  await connection.execute(
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
      template?.id || null,
      template?.version || null,
      renderTemplate(template?.subject || FALLBACK_SUBJECT, context).slice(0, 255),
      renderTemplate(template?.body || FALLBACK_BODY, context),
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
    ]
  );
};
