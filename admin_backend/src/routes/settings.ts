import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/httpErrors.js';
import { getWorkspace } from '../modules/settings/service.js';
import {
  archiveConsultationMode,
  archiveCountryPricing,
  archiveServiceDomain,
  archivePriceOverride,
  archivePricingSlab,
  archiveService,
  archiveUrgencyRule,
  createConsultationMode,
  createCountryPricing,
  createServiceDomain,
  createPriceOverride,
  createPricingSlab,
  createService,
  createUrgencyRule,
  getPricingRules,
  getServiceCatalog,
  updateConsultationMode,
  updateCountryPricing,
  updateServiceDomain,
  updatePriceOverride,
  updatePricingSlab,
  updateService,
  updateUrgencyRule,
} from '../modules/settings/catalogPricing.js';
import {
  archiveInvoicePdfTemplate,
  getInvoicePdfTemplates,
  updateInvoicePdfTemplate,
  uploadInvoicePdfTemplate,
} from '../modules/settings/invoicePdfTemplates.js';
import { getInvoiceSettings, updateInvoiceSettings } from '../modules/settings/invoiceSettings.js';
import {
  archiveReminderSetting,
  createReminderSetting,
  getNotificationSettings,
  updateNotificationDeliverySetting,
  updateReminderSetting,
} from '../modules/settings/notificationSettings.js';
import { getPlatformSettings, updatePlatformSetting } from '../modules/settings/platformSettings.js';
import {
  archiveTeamMember,
  createTeamMember,
  enableTeamMemberLogin,
  getTeamRegistry,
  updateTeamMemberLogin,
  updateTeamMember,
} from '../modules/settings/teamRegistry.js';
import { createAdminUser, updateAdminUser } from '../modules/settings/adminUsers.js';
import {
  archiveRole,
  assignUserRole,
  createRole,
  getWorkspace as getRbacWorkspace,
  removeUserRole,
  updateRole,
  updateRolePermissions,
} from '../modules/rbac/service.js';
import {
  archiveDocumentType,
  archiveTemplate,
  createDocumentType,
  createTemplate,
  getDocumentTypes,
  getTemplates,
  setDefaultTemplate,
  updateDocumentType,
  updateTemplate,
} from '../modules/settings/templatesDocuments.js';
import { GSTIN_PATTERN, normalizeGstin } from '../modules/settings/gstin.js';
import { requireMutationPermission, requireReadActor, requireReadPermission, requirePermission } from './shared.js';

export const settingsRouter = Router();

const invoiceSettingsSchema = z.object({
  billingDisplayName: z.string().trim().min(2).max(200).optional(),
  businessLegalName: z.string().trim().min(2).max(200).optional(),
  businessState: z.string().trim().min(2).max(100).optional(),
  defaultInvoiceTemplateId: z.string().trim().max(64).nullable().optional(),
  defaultGstRatePercent: z.number().min(0).max(100).optional(),
  defaultSacCode: z.string().trim().max(32).nullable().optional(),
  fallbackTaxType: z.enum(['igst', 'cgst_sgst', 'none']).optional(),
  gstEnabled: z.boolean().optional(),
  gstin: z
    .preprocess(
      (value) => (typeof value === 'string' ? normalizeGstin(value) : value),
      z
        .string()
        .regex(GSTIN_PATTERN, 'GSTIN must be a 15-character Indian GSTIN.')
        .nullable()
    )
    .optional(),
  invoiceFooter: z.string().trim().max(4000).nullable().optional(),
  invoicePrefix: z.string().trim().min(1).max(24).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  pricesIncludeTax: z.boolean().optional(),
  reverseChargeNote: z.string().trim().max(2000).nullable().optional(),
  taxMode: z.enum(['forward_charge', 'reverse_charge', 'exempt']).optional(),
});

const invoicePdfTemplateUploadSchema = z.object({
  contentBase64: z.string().trim().min(20),
  contentBottomMargin: z.number().min(0).max(360).optional(),
  contentLeftMargin: z.number().min(0).max(360).optional(),
  contentRightMargin: z.number().min(0).max(360).optional(),
  contentTopMargin: z.number().min(0).max(360).optional(),
  name: z.string().trim().min(2).max(180),
  originalFileName: z.string().trim().min(5).max(255),
  setActive: z.boolean().optional(),
});

const invoicePdfTemplateUpdateSchema = z.object({
  contentBottomMargin: z.number().min(0).max(360).optional(),
  contentLeftMargin: z.number().min(0).max(360).optional(),
  contentRightMargin: z.number().min(0).max(360).optional(),
  contentTopMargin: z.number().min(0).max(360).optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(2).max(180).optional(),
});

const platformSettingSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  version: z.number().int().positive().optional(),
});

const serviceCreateSchema = z.object({
  baseFee: z.number().min(0).optional(),
  code: z.string().trim().max(64).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  icon: z.string().trim().max(64).nullable().optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(2).max(180),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

const serviceUpdateSchema = serviceCreateSchema.omit({ code: true }).partial();

const serviceDomainCreateSchema = z.object({
  code: z.string().trim().max(64).optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(2).max(160),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

const serviceDomainUpdateSchema = serviceDomainCreateSchema.omit({ code: true }).partial();

const pricingSlabCreateSchema = z.object({
  baseAmount: z.number().min(0),
  effectiveFrom: z.string().trim(),
  effectiveTo: z.string().trim().nullable().optional(),
  isActive: z.boolean().optional(),
  maxServiceCount: z.number().int().positive().nullable().optional(),
  minServiceCount: z.number().int().positive(),
  perExtraServiceAmount: z.number().min(0).nullable().optional(),
});

const pricingSlabUpdateSchema = pricingSlabCreateSchema.partial();

const urgencyRuleCreateSchema = z.object({
  allowInPerson: z.boolean().optional(),
  allowPhone: z.boolean().optional(),
  allowVideo: z.boolean().optional(),
  code: z.string().trim().max(32).optional(),
  isActive: z.boolean().optional(),
  label: z.string().trim().min(1).max(120),
  maxResponseHours: z.number().int().nonnegative().nullable().optional(),
  minResponseHours: z.number().int().nonnegative().nullable().optional(),
  responseWindowHours: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  surchargeType: z.enum(['flat', 'percent']),
  surchargeValue: z.number().min(0),
  timingLabel: z.string().trim().max(120).nullable().optional(),
});

const urgencyRuleUpdateSchema = urgencyRuleCreateSchema.omit({ code: true }).partial();

const consultationModeCreateSchema = z.object({
  code: z.string().trim().max(32).optional(),
  description: z.string().trim().max(255).nullable().optional(),
  isActive: z.boolean().optional(),
  label: z.string().trim().min(1).max(100),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  surchargeValue: z.number().min(0).optional(),
  transportDisclaimer: z.string().trim().max(500).nullable().optional(),
});

const consultationModeUpdateSchema = consultationModeCreateSchema.omit({ code: true }).partial();

const countryPricingCreateSchema = z.object({
  countryCode: z.string().trim().max(8).optional(),
  countryName: z.string().trim().min(1).max(120),
  currencyCode: z.literal('USD').default('USD'),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  multiplier: z.number().min(0),
});

const countryPricingUpdateSchema = countryPricingCreateSchema.omit({ countryCode: true }).partial();

const priceOverrideCreateSchema = z.object({
  countryCode: z.string().trim().min(1).max(8),
  countryName: z.string().trim().max(120).optional(),
  currencyCode: z.literal('USD').default('USD'),
  isActive: z.boolean().optional(),
  priceAmount: z.number().min(0),
  subjectCode: z.string().trim().min(1).max(64),
  subjectType: z.enum(['consultation_mode', 'service', 'urgency']),
});

const priceOverrideUpdateSchema = priceOverrideCreateSchema
  .omit({ subjectCode: true, subjectType: true })
  .partial();

const templateCreateSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(2).max(180),
  subject: z.string().trim().max(255).nullable().optional(),
  type: z.enum(['invoice', 'message', 'notification', 'document_checklist', 'general']),
  variables: z.array(z.string().trim().min(1).max(64)).optional(),
});

const templateUpdateSchema = templateCreateSchema.partial().omit({ type: true });

const documentTypeCreateSchema = z.object({
  allowedExtensions: z.array(z.string().trim().min(1).max(16)).min(1),
  category: z.string().trim().min(1).max(64),
  clientVisibleDefault: z.boolean().optional(),
  code: z.string().trim().max(32).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  displayOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
  maxSizeMb: z.number().int().min(1).max(200),
  name: z.string().trim().min(2).max(140),
  requiresReview: z.boolean().optional(),
});

const documentTypeUpdateSchema = documentTypeCreateSchema.partial().omit({ code: true });

const teamMemberCreateSchema = z.object({
  active: z.boolean().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  country: z.string().trim().max(16).nullable().optional(),
  email: z.string().trim().max(255).nullable().optional(),
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(40).nullable().optional(),
  specialization: z.string().trim().max(255).nullable().optional(),
  state: z.string().trim().max(100).nullable().optional(),
  type: z.enum(['internal_staff', 'external_counsel', 'field_partner']),
});

const teamMemberUpdateSchema = teamMemberCreateSchema.partial().omit({ type: true });

const notificationDeliveryUpdateSchema = z.object({
  emailEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
  isActive: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  templateId: z.string().trim().max(64).nullable().optional(),
});

const reminderSettingCreateSchema = z.object({
  channelCode: z.enum(['in_app', 'email', 'sms']),
  eventTypeCode: z.string().trim().max(32).nullable().optional(),
  isActive: z.boolean().optional(),
  offsetMinutes: z.number().int().min(1).max(10080),
});

const reminderSettingUpdateSchema = reminderSettingCreateSchema.partial();

const rbacRoleCreateSchema = z.object({
  code: z.string().trim().min(2).max(64).optional(),
  description: z.string().trim().max(1000).optional(),
  name: z.string().trim().min(2).max(160),
});

const rbacRoleUpdateSchema = z.object({
  description: z.string().trim().max(1000).optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(2).max(160).optional(),
});

const rbacRolePermissionsSchema = z.object({
  permissionCodes: z.array(z.string().trim().min(1).max(128)),
});

const rbacUserRoleSchema = z.object({
  roleCode: z.string().trim().min(1).max(64),
});

const adminUserCreateSchema = z.object({
  active: z.boolean().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  counselPartnerId: z.string().trim().min(1).max(64).nullable().optional(),
  displayName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  loginEnabled: z.boolean().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-().\s]{6,40}$/, 'Enter a valid phone number.')
    .nullable()
    .optional(),
  provisioningKind: z.enum(['admin', 'advocate', 'billing_staff', 'internal_staff']).optional(),
  requirePasswordRotation: z.boolean().optional(),
  roleCode: z.string().trim().min(1).max(64),
  sendSetupEmail: z.boolean().optional(),
  staffProfileUserId: z.string().trim().min(1).max(64).nullable().optional(),
  state: z.string().trim().max(100).nullable().optional(),
});

const adminUserUpdateSchema = z.object({
  active: z.boolean().optional(),
  loginEnabled: z.boolean().optional(),
}).refine((value) => value.active !== undefined || value.loginEnabled !== undefined, {
  message: 'Choose whether admin login should be enabled.',
});

const teamMemberEnableLoginSchema = z.object({
  note: z.string().trim().max(1000).nullable().optional(),
  requirePasswordRotation: z.boolean().optional(),
  roleCode: z.string().trim().min(1).max(64).nullable().optional(),
  sendSetupEmail: z.boolean().optional(),
});

const teamMemberLoginUpdateSchema = z.object({
  loginEnabled: z.boolean(),
});

settingsRouter.get(
  '/settings/workspace',
  asyncHandler(async (request, response) => {
    const actor = requirePermission(await requireReadActor(request), 'dashboard.view');
    response.json(await getWorkspace(actor));
  })
);

settingsRouter.get(
  '/settings/invoice',
  asyncHandler(async (request, response) => {
    requirePermission(await requireReadActor(request), 'invoice.view');
    response.json(await getInvoiceSettings());
  })
);

settingsRouter.get(
  '/settings/invoice/pdf-templates',
  asyncHandler(async (request, response) => {
    requirePermission(await requireReadActor(request), 'invoice.view');
    response.json(await getInvoicePdfTemplates());
  })
);

settingsRouter.post(
  '/settings/invoice/pdf-templates',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    response.status(201).json(
      await uploadInvoicePdfTemplate(actor, invoicePdfTemplateUploadSchema.parse(request.body))
    );
  })
);

settingsRouter.patch(
  '/settings/invoice/pdf-templates/:templateId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const templateId = z.string().trim().min(1).max(64).parse(request.params.templateId);
    response.json(
      await updateInvoicePdfTemplate(actor, templateId, invoicePdfTemplateUpdateSchema.parse(request.body))
    );
  })
);

settingsRouter.post(
  '/settings/invoice/pdf-templates/:templateId/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const templateId = z.string().trim().min(1).max(64).parse(request.params.templateId);
    response.json(await archiveInvoicePdfTemplate(actor, templateId));
  })
);

settingsRouter.get(
  '/settings/platform',
  asyncHandler(async (request, response) => {
    requirePermission(await requireReadActor(request), 'dashboard.view');
    response.json({ settings: await getPlatformSettings() });
  })
);

settingsRouter.get(
  '/settings/rbac',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'rbac.manage');
    response.json(await getRbacWorkspace());
  })
);

settingsRouter.post(
  '/settings/rbac/roles',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'rbac.manage');
    response.status(201).json(await createRole(actor, rbacRoleCreateSchema.parse(request.body)));
  })
);

settingsRouter.patch(
  '/settings/rbac/roles/:roleId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'rbac.manage');
    const roleId = z.string().trim().min(1).max(64).parse(request.params.roleId);
    response.json(await updateRole(actor, roleId, rbacRoleUpdateSchema.parse(request.body)));
  })
);

settingsRouter.post(
  '/settings/rbac/roles/:roleId/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'rbac.manage');
    const roleId = z.string().trim().min(1).max(64).parse(request.params.roleId);
    response.json(await archiveRole(actor, roleId));
  })
);

settingsRouter.put(
  '/settings/rbac/roles/:roleId/permissions',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'rbac.manage');
    const roleId = z.string().trim().min(1).max(64).parse(request.params.roleId);
    const body = rbacRolePermissionsSchema.parse(request.body);
    response.json(await updateRolePermissions(actor, roleId, body.permissionCodes));
  })
);

settingsRouter.post(
  '/settings/rbac/users/:userId/roles',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'rbac.manage');
    const userId = z.string().trim().min(1).max(64).parse(request.params.userId);
    const body = rbacUserRoleSchema.parse(request.body);
    response.status(201).json(await assignUserRole(actor, userId, body.roleCode));
  })
);

settingsRouter.delete(
  '/settings/rbac/users/:userId/roles/:roleId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'rbac.manage');
    const userId = z.string().trim().min(1).max(64).parse(request.params.userId);
    const roleId = z.string().trim().min(1).max(64).parse(request.params.roleId);
    response.json(await removeUserRole(actor, userId, roleId));
  })
);

settingsRouter.post(
  '/settings/admin-users',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'rbac.manage');
    response.status(201).json(await createAdminUser(actor, adminUserCreateSchema.parse(request.body)));
  })
);

settingsRouter.patch(
  '/settings/admin-users/:userId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'rbac.manage');
    const userId = z.string().trim().min(1).max(64).parse(request.params.userId);
    response.json(await updateAdminUser(actor, userId, adminUserUpdateSchema.parse(request.body)));
  })
);

settingsRouter.patch(
  '/settings/platform/:key',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const key = z.string().parse(request.params.key);
    response.json(await updatePlatformSetting(actor, key, platformSettingSchema.parse(request.body)));
  })
);

settingsRouter.get(
  '/settings/team',
  asyncHandler(async (request, response) => {
    const actor = await requireReadPermission(request, 'counsel_partner.view');
    response.json(await getTeamRegistry(actor));
  })
);

settingsRouter.post(
  '/settings/team/members',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'counsel_partner.manage');
    response.status(201).json(await createTeamMember(actor, teamMemberCreateSchema.parse(request.body)));
  })
);

settingsRouter.patch(
  '/settings/team/members/:memberId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'counsel_partner.manage');
    const memberId = z.string().trim().min(1).max(64).parse(request.params.memberId);
    response.json(await updateTeamMember(actor, memberId, teamMemberUpdateSchema.parse(request.body)));
  })
);

settingsRouter.post(
  '/settings/team/members/:memberId/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'counsel_partner.manage');
    const memberId = z.string().trim().min(1).max(64).parse(request.params.memberId);
    response.json(await archiveTeamMember(actor, memberId));
  })
);

settingsRouter.post(
  '/settings/team/members/:memberId/enable-login',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'rbac.manage');
    requirePermission(actor, 'counsel_partner.manage');
    const memberId = z.string().trim().min(1).max(64).parse(request.params.memberId);
    response.status(201).json(
      await enableTeamMemberLogin(actor, memberId, teamMemberEnableLoginSchema.parse(request.body))
    );
  })
);

settingsRouter.patch(
  '/settings/team/members/:memberId/login',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'rbac.manage');
    requirePermission(actor, 'counsel_partner.manage');
    const memberId = z.string().trim().min(1).max(64).parse(request.params.memberId);
    response.json(
      await updateTeamMemberLogin(actor, memberId, teamMemberLoginUpdateSchema.parse(request.body))
    );
  })
);

settingsRouter.get(
  '/settings/service-catalog',
  asyncHandler(async (request, response) => {
    requirePermission(await requireReadActor(request), 'dashboard.view');
    response.json(await getServiceCatalog());
  })
);

settingsRouter.post(
  '/settings/service-catalog/domains',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    response.status(201).json(await createServiceDomain(actor, serviceDomainCreateSchema.parse(request.body)));
  })
);

settingsRouter.patch(
  '/settings/service-catalog/domains/:domainCode',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const domainCode = z.string().trim().min(1).max(64).parse(request.params.domainCode);
    response.json(await updateServiceDomain(actor, domainCode, serviceDomainUpdateSchema.parse(request.body)));
  })
);

settingsRouter.post(
  '/settings/service-catalog/domains/:domainCode/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const domainCode = z.string().trim().min(1).max(64).parse(request.params.domainCode);
    response.json(await archiveServiceDomain(actor, domainCode));
  })
);

settingsRouter.post(
  '/settings/service-catalog/services',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    response.status(201).json(await createService(actor, serviceCreateSchema.parse(request.body)));
  })
);

settingsRouter.patch(
  '/settings/service-catalog/services/:serviceId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const serviceId = z.string().parse(request.params.serviceId);
    response.json(await updateService(actor, serviceId, serviceUpdateSchema.parse(request.body)));
  })
);

settingsRouter.post(
  '/settings/service-catalog/services/:serviceId/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const serviceId = z.string().parse(request.params.serviceId);
    response.json(await archiveService(actor, serviceId));
  })
);

settingsRouter.get(
  '/settings/pricing-rules',
  asyncHandler(async (request, response) => {
    requirePermission(await requireReadActor(request), 'dashboard.view');
    response.json(await getPricingRules());
  })
);

settingsRouter.post(
  '/settings/pricing-rules/slabs',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    response.status(201).json(await createPricingSlab(actor, pricingSlabCreateSchema.parse(request.body)));
  })
);

settingsRouter.patch(
  '/settings/pricing-rules/slabs/:slabId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const slabId = z.string().parse(request.params.slabId);
    response.json(await updatePricingSlab(actor, slabId, pricingSlabUpdateSchema.parse(request.body)));
  })
);

settingsRouter.post(
  '/settings/pricing-rules/slabs/:slabId/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const slabId = z.string().parse(request.params.slabId);
    response.json(await archivePricingSlab(actor, slabId));
  })
);

settingsRouter.post(
  '/settings/pricing-rules/urgency',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    response.status(201).json(await createUrgencyRule(actor, urgencyRuleCreateSchema.parse(request.body)));
  })
);

settingsRouter.patch(
  '/settings/pricing-rules/urgency/:ruleId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const ruleId = z.string().parse(request.params.ruleId);
    response.json(await updateUrgencyRule(actor, ruleId, urgencyRuleUpdateSchema.parse(request.body)));
  })
);

settingsRouter.post(
  '/settings/pricing-rules/urgency/:ruleId/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const ruleId = z.string().parse(request.params.ruleId);
    response.json(await archiveUrgencyRule(actor, ruleId));
  })
);

settingsRouter.post(
  '/settings/pricing-rules/consultation-modes',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    response.status(201).json(
      await createConsultationMode(actor, consultationModeCreateSchema.parse(request.body))
    );
  })
);

settingsRouter.patch(
  '/settings/pricing-rules/consultation-modes/:modeCode',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const modeCode = z.string().trim().min(1).max(32).parse(request.params.modeCode);
    response.json(
      await updateConsultationMode(actor, modeCode, consultationModeUpdateSchema.parse(request.body))
    );
  })
);

settingsRouter.post(
  '/settings/pricing-rules/consultation-modes/:modeCode/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const modeCode = z.string().trim().min(1).max(32).parse(request.params.modeCode);
    response.json(await archiveConsultationMode(actor, modeCode));
  })
);

settingsRouter.post(
  '/settings/pricing-rules/country-pricing',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    response.status(201).json(
      await createCountryPricing(actor, countryPricingCreateSchema.parse(request.body))
    );
  })
);

settingsRouter.patch(
  '/settings/pricing-rules/country-pricing/:countryPricingId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const countryPricingId = z.string().parse(request.params.countryPricingId);
    response.json(
      await updateCountryPricing(actor, countryPricingId, countryPricingUpdateSchema.parse(request.body))
    );
  })
);

settingsRouter.post(
  '/settings/pricing-rules/country-pricing/:countryPricingId/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const countryPricingId = z.string().parse(request.params.countryPricingId);
    response.json(await archiveCountryPricing(actor, countryPricingId));
  })
);

settingsRouter.post(
  '/settings/pricing-rules/price-overrides',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    response.status(201).json(await createPriceOverride(actor, priceOverrideCreateSchema.parse(request.body)));
  })
);

settingsRouter.patch(
  '/settings/pricing-rules/price-overrides/:overrideId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const overrideId = z.string().parse(request.params.overrideId);
    response.json(await updatePriceOverride(actor, overrideId, priceOverrideUpdateSchema.parse(request.body)));
  })
);

settingsRouter.post(
  '/settings/pricing-rules/price-overrides/:overrideId/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const overrideId = z.string().parse(request.params.overrideId);
    response.json(await archivePriceOverride(actor, overrideId));
  })
);

settingsRouter.get(
  '/settings/templates',
  asyncHandler(async (request, response) => {
    requirePermission(await requireReadActor(request), 'dashboard.view');
    response.json(await getTemplates());
  })
);

settingsRouter.post(
  '/settings/templates',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    response.status(201).json(await createTemplate(actor, templateCreateSchema.parse(request.body)));
  })
);

settingsRouter.get(
  '/settings/notifications',
  asyncHandler(async (request, response) => {
    requirePermission(await requireReadActor(request), 'dashboard.view');
    response.json(await getNotificationSettings());
  })
);

settingsRouter.patch(
  '/settings/notifications/types/:typeCode',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const typeCode = z.string().trim().min(1).max(64).parse(request.params.typeCode);
    response.json(
      await updateNotificationDeliverySetting(
        actor,
        typeCode,
        notificationDeliveryUpdateSchema.parse(request.body)
      )
    );
  })
);

settingsRouter.post(
  '/settings/notifications/reminder-offsets',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    response.status(201).json(await createReminderSetting(actor, reminderSettingCreateSchema.parse(request.body)));
  })
);

settingsRouter.patch(
  '/settings/notifications/reminder-offsets/:settingId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const settingId = z.string().trim().min(1).max(64).parse(request.params.settingId);
    response.json(await updateReminderSetting(actor, settingId, reminderSettingUpdateSchema.parse(request.body)));
  })
);

settingsRouter.post(
  '/settings/notifications/reminder-offsets/:settingId/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const settingId = z.string().trim().min(1).max(64).parse(request.params.settingId);
    response.json(await archiveReminderSetting(actor, settingId));
  })
);

settingsRouter.patch(
  '/settings/templates/:templateId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const templateId = z.string().parse(request.params.templateId);
    response.json(await updateTemplate(actor, templateId, templateUpdateSchema.parse(request.body)));
  })
);

settingsRouter.post(
  '/settings/templates/:templateId/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const templateId = z.string().parse(request.params.templateId);
    response.json(await archiveTemplate(actor, templateId));
  })
);

settingsRouter.post(
  '/settings/templates/:templateId/set-default',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const templateId = z.string().parse(request.params.templateId);
    response.json(await setDefaultTemplate(actor, templateId));
  })
);

settingsRouter.get(
  '/settings/document-types',
  asyncHandler(async (request, response) => {
    requirePermission(await requireReadActor(request), 'dashboard.view');
    response.json(await getDocumentTypes());
  })
);

settingsRouter.post(
  '/settings/document-types',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    response.status(201).json(await createDocumentType(actor, documentTypeCreateSchema.parse(request.body)));
  })
);

settingsRouter.patch(
  '/settings/document-types/:documentTypeId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const documentTypeId = z.string().parse(request.params.documentTypeId);
    response.json(await updateDocumentType(actor, documentTypeId, documentTypeUpdateSchema.parse(request.body)));
  })
);

settingsRouter.post(
  '/settings/document-types/:documentTypeId/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'settings.manage');
    const documentTypeId = z.string().parse(request.params.documentTypeId);
    response.json(await archiveDocumentType(actor, documentTypeId));
  })
);

settingsRouter.patch(
  '/settings/invoice',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'invoice.manage');
    response.json(await updateInvoiceSettings(actor, invoiceSettingsSchema.parse(request.body)));
  })
);
