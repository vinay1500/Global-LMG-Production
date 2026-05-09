import type { RowDataPacket } from 'mysql2/promise';
import { badRequest } from '../../lib/httpErrors.js';
import { executeStatement, queryRows, type QueryExecutor } from '../../lib/mysql.js';
import type { AdminActor } from '../auth/service.js';
import { createAuditEvent } from '../writeSupport.js';
import { isValidGstin, normalizeGstin } from './gstin.js';

export type InvoiceTaxMode = 'exempt' | 'forward_charge' | 'reverse_charge';
export type InvoiceFallbackTaxType = 'cgst_sgst' | 'igst' | 'none';

export type InvoiceSettings = {
  billingDisplayName: string;
  businessAddress: string | null;
  businessEmail: string | null;
  businessLegalName: string;
  businessPhone: string | null;
  businessState: string;
  businessWebsite: string | null;
  defaultInvoiceTemplateId: string | null;
  defaultGstRateBps: number;
  defaultGstRatePercent: number;
  defaultSacCode: string | null;
  fallbackTaxType: InvoiceFallbackTaxType;
  gstEnabled: boolean;
  gstin: string | null;
  invoiceFooter: string | null;
  invoicePrefix: string;
  invoiceTerms: string | null;
  paymentInstructions: string | null;
  paymentTermsDays: number;
  pricesIncludeTax: boolean;
  reverseChargeNote: string | null;
  taxMode: InvoiceTaxMode;
};

export type UpdateInvoiceSettingsPayload = Partial<{
  billingDisplayName: string;
  businessAddress: string | null;
  businessEmail: string | null;
  businessLegalName: string;
  businessPhone: string | null;
  businessState: string;
  businessWebsite: string | null;
  defaultInvoiceTemplateId: string | null;
  defaultGstRatePercent: number;
  defaultSacCode: string | null;
  fallbackTaxType: InvoiceFallbackTaxType;
  gstEnabled: boolean;
  gstin: string | null;
  invoiceFooter: string | null;
  invoicePrefix: string;
  invoiceTerms: string | null;
  paymentInstructions: string | null;
  paymentTermsDays: number;
  pricesIncludeTax: boolean;
  reverseChargeNote: string | null;
  taxMode: InvoiceTaxMode;
}>;

type InvoiceSettingsRow = RowDataPacket & {
  billingDisplayName: string;
  businessAddress: string | null;
  businessEmail: string | null;
  businessLegalName: string;
  businessPhone: string | null;
  businessState: string;
  businessWebsite: string | null;
  defaultInvoiceTemplateId: string | null;
  defaultGstRateBps: number;
  defaultSacCode: string | null;
  fallbackTaxType: InvoiceFallbackTaxType;
  gstEnabled: number;
  gstin: string | null;
  invoiceFooter: string | null;
  invoicePrefix: string;
  invoiceTerms: string | null;
  paymentInstructions: string | null;
  paymentTermsDays: number;
  pricesIncludeTax: number;
  reverseChargeNote: string | null;
  taxMode: InvoiceTaxMode;
};

const trimNullable = (value: string | null | undefined) => {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const mapRow = (row: InvoiceSettingsRow): InvoiceSettings => ({
  billingDisplayName: row.billingDisplayName,
  businessAddress: row.businessAddress,
  businessEmail: row.businessEmail,
  businessLegalName: row.businessLegalName,
  businessPhone: row.businessPhone,
  businessState: row.businessState,
  businessWebsite: row.businessWebsite,
  defaultInvoiceTemplateId: row.defaultInvoiceTemplateId,
  defaultGstRateBps: Number(row.defaultGstRateBps || 0),
  defaultGstRatePercent: Number(row.defaultGstRateBps || 0) / 100,
  defaultSacCode: row.defaultSacCode,
  fallbackTaxType: row.fallbackTaxType,
  gstEnabled: Boolean(row.gstEnabled),
  gstin: row.gstin,
  invoiceFooter: row.invoiceFooter,
  invoicePrefix: row.invoicePrefix,
  invoiceTerms: row.invoiceTerms,
  paymentInstructions: row.paymentInstructions,
  paymentTermsDays: Number(row.paymentTermsDays || 0),
  pricesIncludeTax: Boolean(row.pricesIncludeTax),
  reverseChargeNote: row.reverseChargeNote,
  taxMode: row.taxMode,
});

export const getInvoiceSettings = async (executor?: QueryExecutor): Promise<InvoiceSettings> => {
  const rows = await queryRows<InvoiceSettingsRow>(
    `SELECT
       business_legal_name AS businessLegalName,
       billing_display_name AS billingDisplayName,
       gstin,
       business_state AS businessState,
       business_address AS businessAddress,
       business_phone AS businessPhone,
       business_email AS businessEmail,
       business_website AS businessWebsite,
       invoice_prefix AS invoicePrefix,
       default_invoice_template_public_id AS defaultInvoiceTemplateId,
       default_sac_code AS defaultSacCode,
       gst_enabled AS gstEnabled,
       default_gst_rate_bps AS defaultGstRateBps,
       tax_mode_code AS taxMode,
       prices_include_tax AS pricesIncludeTax,
       fallback_tax_type_code AS fallbackTaxType,
       payment_terms_days AS paymentTermsDays,
       payment_instructions AS paymentInstructions,
       invoice_terms AS invoiceTerms,
       invoice_footer AS invoiceFooter,
       reverse_charge_note AS reverseChargeNote
     FROM invoice_settings
     WHERE id = 1
     LIMIT 1`,
    [],
    executor
  );

  if (rows[0]) {
    return mapRow(rows[0]);
  }

  await executeStatement(
    `INSERT INTO invoice_settings (
       id,
       business_legal_name,
       billing_display_name,
       gstin,
       business_state,
       invoice_prefix,
       default_sac_code,
       gst_enabled,
       default_gst_rate_bps,
       tax_mode_code,
       prices_include_tax,
       fallback_tax_type_code,
       payment_terms_days,
       invoice_footer,
       reverse_charge_note,
       created_at,
       updated_at
     ) VALUES (
       1,
       'Global LMG',
       'Global LMG',
       NULL,
       'Not configured',
       'INV',
       NULL,
       1,
       1800,
       'forward_charge',
       0,
       'igst',
       7,
       'Global LMG provides intermediary legal consultancy, coordination, and support services. This invoice is not for legal representation by Global LMG.',
       'Tax payable under reverse charge where applicable.',
       UTC_TIMESTAMP(6),
       UTC_TIMESTAMP(6)
     )`,
    [],
    executor
  );

  return getInvoiceSettings(executor);
};

export const updateInvoiceSettings = async (
  actor: AdminActor,
  payload: UpdateInvoiceSettingsPayload
) => {
  const existing = await getInvoiceSettings();
  const next: InvoiceSettings = {
    ...existing,
    billingDisplayName: payload.billingDisplayName?.trim() || existing.billingDisplayName,
    businessAddress:
      payload.businessAddress === undefined ? existing.businessAddress : trimNullable(payload.businessAddress),
    businessEmail:
      payload.businessEmail === undefined ? existing.businessEmail : trimNullable(payload.businessEmail?.toLowerCase() || null),
    businessLegalName: payload.businessLegalName?.trim() || existing.businessLegalName,
    businessPhone:
      payload.businessPhone === undefined ? existing.businessPhone : trimNullable(payload.businessPhone),
    businessState: payload.businessState?.trim() || existing.businessState,
    businessWebsite:
      payload.businessWebsite === undefined ? existing.businessWebsite : trimNullable(payload.businessWebsite),
    defaultGstRateBps:
      payload.defaultGstRatePercent === undefined
        ? existing.defaultGstRateBps
        : Math.round(payload.defaultGstRatePercent * 100),
    defaultInvoiceTemplateId:
      payload.defaultInvoiceTemplateId === undefined
        ? existing.defaultInvoiceTemplateId
        : trimNullable(payload.defaultInvoiceTemplateId),
    defaultGstRatePercent:
      payload.defaultGstRatePercent === undefined
        ? existing.defaultGstRatePercent
        : payload.defaultGstRatePercent,
    defaultSacCode:
      payload.defaultSacCode === undefined ? existing.defaultSacCode : trimNullable(payload.defaultSacCode),
    fallbackTaxType: payload.fallbackTaxType || existing.fallbackTaxType,
    gstEnabled: payload.gstEnabled ?? existing.gstEnabled,
    gstin: payload.gstin === undefined ? existing.gstin : normalizeGstin(payload.gstin),
    invoiceFooter:
      payload.invoiceFooter === undefined ? existing.invoiceFooter : trimNullable(payload.invoiceFooter),
    invoicePrefix: payload.invoicePrefix?.trim() || existing.invoicePrefix,
    invoiceTerms:
      payload.invoiceTerms === undefined ? existing.invoiceTerms : trimNullable(payload.invoiceTerms),
    paymentInstructions:
      payload.paymentInstructions === undefined
        ? existing.paymentInstructions
        : trimNullable(payload.paymentInstructions),
    paymentTermsDays: payload.paymentTermsDays ?? existing.paymentTermsDays,
    pricesIncludeTax: payload.pricesIncludeTax ?? existing.pricesIncludeTax,
    reverseChargeNote:
      payload.reverseChargeNote === undefined
        ? existing.reverseChargeNote
        : trimNullable(payload.reverseChargeNote),
    taxMode: payload.taxMode || existing.taxMode,
  };

  if (next.gstin && !isValidGstin(next.gstin)) {
    throw badRequest('invalid_gstin', 'GSTIN must be a 15-character Indian GSTIN.');
  }

  if (next.defaultGstRateBps < 0 || next.defaultGstRateBps > 10000) {
    throw badRequest('invalid_gst_rate', 'GST rate must be between 0 and 100 percent.');
  }

  if (next.paymentTermsDays < 0 || next.paymentTermsDays > 365) {
    throw badRequest('invalid_payment_terms', 'Payment terms must be between 0 and 365 days.');
  }

  if (next.defaultInvoiceTemplateId) {
    const templateRows = await queryRows<RowDataPacket & { id: string }>(
      `SELECT public_id AS id
       FROM admin_templates
       WHERE public_id = ?
         AND template_type_code = 'invoice'
         AND is_active = 1
         AND archived_at IS NULL
       LIMIT 1`,
      [next.defaultInvoiceTemplateId]
    );

    if (!templateRows[0]) {
      throw badRequest('invalid_invoice_template', 'Select an active invoice template.');
    }
  }

  await executeStatement(
    `UPDATE invoice_settings
     SET business_legal_name = ?,
         billing_display_name = ?,
         gstin = ?,
         business_state = ?,
         business_address = ?,
         business_phone = ?,
         business_email = ?,
         business_website = ?,
         invoice_prefix = ?,
         default_sac_code = ?,
         gst_enabled = ?,
         default_gst_rate_bps = ?,
         tax_mode_code = ?,
         prices_include_tax = ?,
         fallback_tax_type_code = ?,
         payment_terms_days = ?,
         payment_instructions = ?,
         invoice_terms = ?,
         invoice_footer = ?,
         reverse_charge_note = ?,
         default_invoice_template_public_id = ?,
         updated_at = UTC_TIMESTAMP(6),
         row_version = row_version + 1
     WHERE id = 1`,
    [
      next.businessLegalName,
      next.billingDisplayName,
      next.gstin,
      next.businessState,
      next.businessAddress,
      next.businessPhone,
      next.businessEmail,
      next.businessWebsite,
      next.invoicePrefix,
      next.defaultSacCode,
      next.gstEnabled ? 1 : 0,
      next.defaultGstRateBps,
      next.taxMode,
      next.pricesIncludeTax ? 1 : 0,
      next.fallbackTaxType,
      next.paymentTermsDays,
      next.paymentInstructions,
      next.invoiceTerms,
      next.invoiceFooter,
      next.reverseChargeNote,
      next.defaultInvoiceTemplateId,
    ]
  );

  await createAuditEvent({
    actionCode: 'invoice_settings.updated',
    actionLabel: 'Invoice settings updated',
    actorRoleCode: actor.roleCodes[0] || 'billing_admin',
    actorUserId: actor.userId,
    changes: [
      { fieldName: 'business_legal_name', oldValue: existing.businessLegalName, newValue: next.businessLegalName },
      { fieldName: 'business_address', oldValue: existing.businessAddress, newValue: next.businessAddress },
      { fieldName: 'business_phone', oldValue: existing.businessPhone, newValue: next.businessPhone },
      { fieldName: 'business_email', oldValue: existing.businessEmail, newValue: next.businessEmail },
      { fieldName: 'gstin', oldValue: existing.gstin, newValue: next.gstin },
      { fieldName: 'business_state', oldValue: existing.businessState, newValue: next.businessState },
      { fieldName: 'default_gst_rate_bps', oldValue: existing.defaultGstRateBps, newValue: next.defaultGstRateBps },
      { fieldName: 'default_invoice_template_public_id', oldValue: existing.defaultInvoiceTemplateId, newValue: next.defaultInvoiceTemplateId },
      { fieldName: 'tax_mode_code', oldValue: existing.taxMode, newValue: next.taxMode },
      { fieldName: 'prices_include_tax', oldValue: existing.pricesIncludeTax, newValue: next.pricesIncludeTax },
      { fieldName: 'fallback_tax_type_code', oldValue: existing.fallbackTaxType, newValue: next.fallbackTaxType },
      { fieldName: 'payment_terms_days', oldValue: existing.paymentTermsDays, newValue: next.paymentTermsDays },
    ],
    entityPk: 1,
    entityTableName: 'invoice_settings',
    sourceModule: 'settings_workspace',
  });

  return getInvoiceSettings();
};
