import type {
  AuditEntriesResponse,
  AdminDocumentDetailResponse,
  BillingWorkspaceResponse,
  ClientWorkspaceResponse,
  CreateMessageThreadResponse,
  ClientsListResponse,
  DashboardWorkspaceResponse,
  DocumentTypePayload,
  DocumentTypesResponse,
  DocumentUploadResponse,
  DocumentsListResponse,
  EventsWorkspaceResponse,
  MatterPackageProposalsResponse,
  MatterWorkspaceResponse,
  MattersListResponse,
  MessagesWorkspaceResponse,
  NotificationsListResponse,
  NotificationDeliverySetting,
  NotificationDeliverySettingPayload,
  NotificationSettingsResponse,
  ReminderProcessResponse,
  ReminderRetryResponse,
  ReminderSetting,
  ReminderSettingPayload,
  ReminderWorkspaceResponse,
  ReportDrilldownKind,
  ReportDrilldownResponse,
  RecordPaymentResponse,
  AdminRequestDecisionResponse,
  ReportsWorkspaceResponse,
  CreateClientPayload,
  CreateClientResponse,
  ConsultationModePayload,
  CountryPricingPayload,
  PriceOverridePayload,
  CreateMatterPayload,
  CreateMatterResponse,
  CreateRbacRolePayload,
  CreateServiceCatalogPayload,
  PricingRulesResponse,
  PricingSlabPayload,
  RequestsWorkspaceResponse,
  RbacWorkspaceResponse,
  SearchResultsResponse,
  ServiceCatalogResponse,
  SettingsWorkspaceResponse,
  SettingsPricingSlab,
  SettingsConsultationMode,
  SettingsCountryPricing,
  SettingsPriceOverride,
  SettingsService,
  SettingsUrgencyRule,
  TasksWorkspaceResponse,
  TemplatePayload,
  TemplatesResponse,
  UpdateRbacRolePayload,
  UpdateRbacRolePermissionsPayload,
  UpdateDocumentTypePayload,
  UpdateConsultationModePayload,
  UpdateCountryPricingPayload,
  UpdatePriceOverridePayload,
  UpdateInvoiceSettingsPayload,
  InvoiceSettings,
  InvoicePdfTemplate,
  InvoicePdfTemplateUpdatePayload,
  InvoicePdfTemplateUploadPayload,
  PlatformSetting,
  PlatformSettingsResponse,
  UpdatePlatformSettingPayload,
  UpdateReminderSettingPayload,
  UpdateServiceCatalogPayload,
  TeamMemberPayload,
  TeamRegistryMember,
  TeamRegistryResponse,
  UpdateTeamMemberPayload,
  UpdateTemplatePayload,
  UpdateUrgencyRulePayload,
  UrgencyRulePayload,
} from './contracts';
import {
  API_DOWNLOAD_TIMEOUT_MS,
  FORM_IDEMPOTENCY_TTL_MS,
  PAYMENT_IDEMPOTENCY_TTL_MS,
  ApiRequestError,
  apiRequest,
  createIdempotencyIdentity,
  fetchWithTimeout,
} from './client';
import { API_ENDPOINTS } from './endpoints';

const withQuery = (url: string, params: Record<string, string | number | undefined>) => {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === '') {
      return;
    }

    searchParams.set(key, String(value));
  });

  const query = searchParams.toString();
  return query ? `${url}?${query}` : url;
};

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

const computeFileSha256 = async (file: File) => {
  const content = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', content);

  return {
    checksumSha256: toHex(digest),
    content,
  };
};

const getAttachmentFileName = (headerValue: string | null, fallback: string) => {
  if (!headerValue) {
    return fallback;
  }

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].replace(/"/g, ''));
  }

  const match = /filename="?([^";]+)"?/i.exec(headerValue);
  return match?.[1] || fallback;
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const fetchBlob = async (url: string, fallbackFileName: string) => {
  const response = await fetchWithTimeout(url, {
    credentials: 'include',
    headers: {
      Accept: 'application/pdf',
    },
  }, API_DOWNLOAD_TIMEOUT_MS);

  if (!response.ok) {
    let message = `Download failed with status ${response.status}`;

    try {
      const errorBody = (await response.json()) as { message?: string };
      message = errorBody.message || message;
    } catch {
      // PDF endpoints may return non-JSON error bodies from proxies; keep the status-based message.
    }

    throw new ApiRequestError('download_failed', message);
  }

  const contentType = response.headers.get('content-type') || '';

  if (!contentType.toLowerCase().includes('application/pdf')) {
    throw new ApiRequestError('invalid_pdf_response', 'The invoice PDF response was not a PDF.');
  }

  return {
    blob: await response.blob(),
    fileName: getAttachmentFileName(response.headers.get('content-disposition'), fallbackFileName),
  };
};

export const adminApi = {
  createClient: (payload: CreateClientPayload) =>
    apiRequest<CreateClientResponse>(API_ENDPOINTS.admin.createClient(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      idempotency: {
        identity: createIdempotencyIdentity('admin-client-create', [
          payload.email,
          payload.phone ?? '',
        ]),
        ttlMs: FORM_IDEMPOTENCY_TTL_MS,
      },
      method: 'POST',
    }),
  createInvoice: (payload: {
    amount: number;
    description: string;
    dueDate?: string;
    matterId: string;
  }) =>
    apiRequest<{ invoiceId: string; status: 'created' }>(API_ENDPOINTS.admin.createInvoice(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      idempotency: {
        identity: createIdempotencyIdentity('admin-invoice-create', [
          payload.matterId,
          payload.amount,
          payload.dueDate ?? '',
          payload.description,
        ]),
        ttlMs: FORM_IDEMPOTENCY_TTL_MS,
      },
      method: 'POST',
    }),
  createEvent: (payload: {
    clientAccountId?: string;
    date: string;
    durationMinutes?: number;
    matterId?: string;
    meetLink?: string;
    mode: string;
    notes?: string;
    time: string;
    title: string;
    type: string;
    visibleToClient?: boolean;
  }) =>
    apiRequest<{ status: 'created' }>(API_ENDPOINTS.admin.createEvent(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  updateEvent: (
    eventId: string,
    payload: {
      clientAccountId?: string;
      date?: string;
      durationMinutes?: number;
      matterId?: string | null;
      meetLink?: string | null;
      mode?: string;
      notes?: string | null;
      time?: string;
      title?: string;
      type?: string;
      visibleToClient?: boolean;
    }
  ) =>
    apiRequest<{ eventId: string; status: 'updated' }>(API_ENDPOINTS.admin.updateEvent(eventId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  cancelEvent: (eventId: string, payload: { reason?: string } = {}) =>
    apiRequest<{ eventId: string; status: 'cancelled' }>(
      API_ENDPOINTS.admin.cancelEvent(eventId),
      {
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }
    ),
  retryEventCalendarSync: (eventId: string) =>
    apiRequest<{ eventId: string; status: 'cancelled' | 'failed' | 'local' | 'synced' }>(
      API_ENDPOINTS.admin.eventCalendarSyncRetry(eventId),
      { method: 'POST' }
    ),
  createMatterAssignment: (
    matterId: string,
    payload: {
      assignmentRoleCode: string;
      counselPartnerId?: string;
      feeAgreedAmount?: number;
      feeDueAmount?: number;
      feePaidAmount?: number;
      internalUserId?: string;
      isPrimary?: boolean;
      notes?: string;
      visibleToClient?: boolean;
    }
  ) =>
    apiRequest<{ status: 'created' }>(API_ENDPOINTS.admin.createMatterAssignment(matterId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  replaceMatterAssignments: (
    matterId: string,
    payload: {
      externalCounsel?: Array<{ id: string; visibleToClient?: boolean }>;
      fieldPartners?: Array<{ id: string; visibleToClient?: boolean }>;
      staff?: Array<{ id: string; visibleToClient?: boolean }>;
    }
  ) =>
    apiRequest<{ status: 'updated' }>(API_ENDPOINTS.admin.replaceMatterAssignments(matterId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    }),
  createMatterNote: (
    matterId: string,
    payload: { bodyText: string; title: string; visibleToClient?: boolean }
  ) =>
    apiRequest<{ status: 'created' }>(API_ENDPOINTS.admin.createMatterNote(matterId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  createMatter: (payload: CreateMatterPayload) =>
    apiRequest<CreateMatterResponse>(API_ENDPOINTS.admin.createMatter(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      idempotency: {
        identity: createIdempotencyIdentity('admin-matter-create', [
          payload.clientAccountPublicId,
          payload.title,
          payload.serviceCode ?? payload.serviceCodes?.join(',') ?? '',
        ]),
        ttlMs: FORM_IDEMPOTENCY_TTL_MS,
      },
      method: 'POST',
    }),
  createRefund: (payload: {
    amount: number;
    invoiceId?: string;
    paymentId: string;
    reasonText: string;
  }) =>
    apiRequest<{ status: 'created' }>(API_ENDPOINTS.admin.createRefund(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      idempotency: {
        identity: createIdempotencyIdentity('admin-refund-create', [
          payload.paymentId,
          payload.invoiceId ?? '',
          payload.amount,
          payload.reasonText,
        ]),
        ttlMs: PAYMENT_IDEMPOTENCY_TTL_MS,
      },
      method: 'POST',
    }),
  recordPayment: (payload: {
    amount: number;
    invoiceId: string;
    notes?: string;
    paymentDate: string;
    paymentMethod: 'bank-transfer' | 'cash' | 'cheque' | 'online';
    referenceNumber?: string;
  }) =>
    apiRequest<RecordPaymentResponse>(API_ENDPOINTS.admin.recordPayment(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      idempotency: {
        identity: createIdempotencyIdentity('admin-manual-payment', [
          payload.invoiceId,
          payload.amount,
          payload.paymentDate,
          payload.paymentMethod,
          payload.referenceNumber ?? '',
        ]),
        ttlMs: PAYMENT_IDEMPOTENCY_TTL_MS,
      },
      method: 'POST',
    }),
  getAuditEntries: (params: { limit?: number; offset?: number } = {}) =>
    apiRequest<AuditEntriesResponse>(
      withQuery(API_ENDPOINTS.admin.audit(), {
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      })
    ),
  getBillingWorkspace: (params: { limit?: number; offset?: number } = {}) =>
    apiRequest<BillingWorkspaceResponse>(
      withQuery(API_ENDPOINTS.admin.billingWorkspace(), {
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      })
    ),
  getClientWorkspace: (clientId: string) =>
    apiRequest<ClientWorkspaceResponse>(API_ENDPOINTS.admin.clientWorkspace(clientId)),
  getDashboardWorkspace: () =>
    apiRequest<DashboardWorkspaceResponse>(API_ENDPOINTS.admin.dashboard()),
  getDocumentDetail: (documentId: string) =>
    apiRequest<AdminDocumentDetailResponse>(API_ENDPOINTS.admin.documentDetail(documentId)),
  getDocuments: (params: { limit?: number; offset?: number } = {}) =>
    apiRequest<DocumentsListResponse>(
      withQuery(API_ENDPOINTS.admin.documents(), {
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      })
    ),
  getEventsWorkspace: (params: { limit?: number; offset?: number } = {}) =>
    apiRequest<EventsWorkspaceResponse>(
      withQuery(API_ENDPOINTS.admin.events(), {
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      })
    ),
  getHealth: () =>
    apiRequest<{ service: string; status: 'ok' }>(API_ENDPOINTS.admin.health()),
  getMatterPackageProposals: (matterId: string) =>
    apiRequest<MatterPackageProposalsResponse>(API_ENDPOINTS.admin.matterPackageProposals(matterId)),
  getMatterWorkspace: (matterId: string) =>
    apiRequest<MatterWorkspaceResponse>(API_ENDPOINTS.admin.matterWorkspace(matterId)),
  getMessagesWorkspace: (params: { limit?: number; offset?: number } = {}) =>
    apiRequest<MessagesWorkspaceResponse>(
      withQuery(API_ENDPOINTS.admin.messagesWorkspace(), {
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      })
    ),
  getNotifications: (params: { limit?: number; offset?: number } = {}) =>
    apiRequest<NotificationsListResponse>(
      withQuery(API_ENDPOINTS.admin.notifications(), {
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      })
    ),
  getReminderWorkspace: () =>
    apiRequest<ReminderWorkspaceResponse>(API_ENDPOINTS.admin.reminderWorkspace()),
  getReportsWorkspace: () =>
    apiRequest<ReportsWorkspaceResponse>(API_ENDPOINTS.admin.reportsWorkspace()),
  getServiceCatalog: () =>
    apiRequest<ServiceCatalogResponse>(API_ENDPOINTS.admin.serviceCatalog()),
  getPlatformSettings: () =>
    apiRequest<PlatformSettingsResponse>(API_ENDPOINTS.admin.platformSettings()),
  getPricingRules: () =>
    apiRequest<PricingRulesResponse>(API_ENDPOINTS.admin.pricingRules()),
  getReportDrilldown: (
    kind: ReportDrilldownKind,
    params: { limit?: number; offset?: number } = {}
  ) =>
    apiRequest<ReportDrilldownResponse>(
      withQuery(API_ENDPOINTS.admin.reportDrilldown(kind), {
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      })
    ),
  getRequestsWorkspace: () =>
    apiRequest<RequestsWorkspaceResponse>(API_ENDPOINTS.admin.requestsWorkspace()),
  getRbacWorkspace: () =>
    apiRequest<RbacWorkspaceResponse>(API_ENDPOINTS.admin.rbacWorkspace()),
  getSettingsRbac: () =>
    apiRequest<RbacWorkspaceResponse>(API_ENDPOINTS.admin.settingsRbac()),
  createRbacRole: (payload: CreateRbacRolePayload) =>
    apiRequest<RbacWorkspaceResponse['roles'][number]>(API_ENDPOINTS.admin.settingsRbacRoles(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  updateRbacRole: (roleId: string, payload: UpdateRbacRolePayload) =>
    apiRequest<RbacWorkspaceResponse['roles'][number]>(API_ENDPOINTS.admin.settingsRbacRole(roleId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  archiveRbacRole: (roleId: string) =>
    apiRequest<RbacWorkspaceResponse['roles'][number]>(API_ENDPOINTS.admin.settingsRbacRoleArchive(roleId), {
      method: 'POST',
    }),
  updateRbacRolePermissions: (roleId: string, payload: UpdateRbacRolePermissionsPayload) =>
    apiRequest<RbacWorkspaceResponse['roles'][number]>(
      API_ENDPOINTS.admin.settingsRbacRolePermissions(roleId),
      {
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      }
    ),
  assignRbacUserRole: (userId: string, roleCode: string) =>
    apiRequest<{ status: 'assigned' }>(API_ENDPOINTS.admin.settingsRbacUserRoles(userId), {
      body: JSON.stringify({ roleCode }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  removeRbacUserRole: (userId: string, roleCode: string) =>
    apiRequest<{ status: 'removed' }>(API_ENDPOINTS.admin.settingsRbacUserRole(userId, roleCode), {
      method: 'DELETE',
    }),
  getSettingsWorkspace: () =>
    apiRequest<SettingsWorkspaceResponse>(API_ENDPOINTS.admin.settingsWorkspace()),
  getNotificationSettings: () =>
    apiRequest<NotificationSettingsResponse>(API_ENDPOINTS.admin.settingsNotifications()),
  getSettingsTeam: () =>
    apiRequest<TeamRegistryResponse>(API_ENDPOINTS.admin.settingsTeam()),
  createTeamMember: (payload: TeamMemberPayload) =>
    apiRequest<TeamRegistryMember>(API_ENDPOINTS.admin.settingsTeamMembers(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  updateTeamMember: (memberId: string, payload: UpdateTeamMemberPayload) =>
    apiRequest<TeamRegistryMember>(API_ENDPOINTS.admin.settingsTeamMember(memberId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  archiveTeamMember: (memberId: string) =>
    apiRequest<{ id: string; status: 'archived' }>(API_ENDPOINTS.admin.settingsTeamMemberArchive(memberId), {
      method: 'POST',
    }),
  updateNotificationTypeSetting: (typeCode: string, payload: NotificationDeliverySettingPayload) =>
    apiRequest<NotificationDeliverySetting>(API_ENDPOINTS.admin.settingsNotificationType(typeCode), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  createReminderSetting: (payload: ReminderSettingPayload) =>
    apiRequest<ReminderSetting>(API_ENDPOINTS.admin.settingsReminderOffsets(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  updateReminderSetting: (settingId: string, payload: UpdateReminderSettingPayload) =>
    apiRequest<ReminderSetting>(API_ENDPOINTS.admin.settingsReminderOffset(settingId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  archiveReminderSetting: (settingId: string) =>
    apiRequest<ReminderSetting>(API_ENDPOINTS.admin.settingsReminderOffsetArchive(settingId), {
      method: 'POST',
    }),
  getSettingsTemplates: () =>
    apiRequest<TemplatesResponse>(API_ENDPOINTS.admin.settingsTemplates()),
  createTemplate: (payload: TemplatePayload) =>
    apiRequest<TemplatesResponse['templates'][number]>(API_ENDPOINTS.admin.settingsTemplates(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  updateTemplate: (templateId: string, payload: UpdateTemplatePayload) =>
    apiRequest<TemplatesResponse['templates'][number]>(API_ENDPOINTS.admin.settingsTemplate(templateId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  archiveTemplate: (templateId: string) =>
    apiRequest<TemplatesResponse['templates'][number]>(API_ENDPOINTS.admin.settingsTemplateArchive(templateId), {
      method: 'POST',
    }),
  setDefaultTemplate: (templateId: string) =>
    apiRequest<TemplatesResponse['templates'][number]>(API_ENDPOINTS.admin.settingsTemplateDefault(templateId), {
      method: 'POST',
    }),
  getSettingsDocumentTypes: () =>
    apiRequest<DocumentTypesResponse>(API_ENDPOINTS.admin.settingsDocumentTypes()),
  createDocumentType: (payload: DocumentTypePayload) =>
    apiRequest<DocumentTypesResponse['documentTypes'][number]>(API_ENDPOINTS.admin.settingsDocumentTypes(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  updateDocumentType: (documentTypeId: string, payload: UpdateDocumentTypePayload) =>
    apiRequest<DocumentTypesResponse['documentTypes'][number]>(
      API_ENDPOINTS.admin.settingsDocumentType(documentTypeId),
      {
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      }
    ),
  archiveDocumentType: (documentTypeId: string) =>
    apiRequest<DocumentTypesResponse['documentTypes'][number]>(
      API_ENDPOINTS.admin.settingsDocumentTypeArchive(documentTypeId),
      { method: 'POST' }
    ),
  createServiceCatalogService: (payload: CreateServiceCatalogPayload) =>
    apiRequest<SettingsService>(API_ENDPOINTS.admin.serviceCatalogServices(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  updateServiceCatalogService: (serviceId: string, payload: UpdateServiceCatalogPayload) =>
    apiRequest<SettingsService>(API_ENDPOINTS.admin.serviceCatalogService(serviceId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  archiveServiceCatalogService: (serviceId: string) =>
    apiRequest<SettingsService>(API_ENDPOINTS.admin.serviceCatalogServiceArchive(serviceId), {
      method: 'POST',
    }),
  createPricingSlab: (payload: PricingSlabPayload) =>
    apiRequest<SettingsPricingSlab>(API_ENDPOINTS.admin.pricingRuleSlabs(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  updatePricingSlab: (slabId: string, payload: Partial<PricingSlabPayload>) =>
    apiRequest<SettingsPricingSlab>(API_ENDPOINTS.admin.pricingRuleSlab(slabId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  archivePricingSlab: (slabId: string) =>
    apiRequest<SettingsPricingSlab>(API_ENDPOINTS.admin.pricingRuleSlabArchive(slabId), {
      method: 'POST',
    }),
  createUrgencyRule: (payload: UrgencyRulePayload) =>
    apiRequest<SettingsUrgencyRule>(API_ENDPOINTS.admin.pricingRuleUrgencyRules(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  updateUrgencyRule: (ruleId: string, payload: UpdateUrgencyRulePayload) =>
    apiRequest<SettingsUrgencyRule>(API_ENDPOINTS.admin.pricingRuleUrgency(ruleId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  archiveUrgencyRule: (ruleId: string) =>
    apiRequest<SettingsUrgencyRule>(API_ENDPOINTS.admin.pricingRuleUrgencyArchive(ruleId), {
      method: 'POST',
    }),
  createConsultationMode: (payload: ConsultationModePayload) =>
    apiRequest<SettingsConsultationMode>(API_ENDPOINTS.admin.pricingRuleConsultationModes(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  updateConsultationMode: (modeCode: string, payload: UpdateConsultationModePayload) =>
    apiRequest<SettingsConsultationMode>(API_ENDPOINTS.admin.pricingRuleConsultationMode(modeCode), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  archiveConsultationMode: (modeCode: string) =>
    apiRequest<SettingsConsultationMode>(API_ENDPOINTS.admin.pricingRuleConsultationModeArchive(modeCode), {
      method: 'POST',
    }),
  createCountryPricing: (payload: CountryPricingPayload) =>
    apiRequest<SettingsCountryPricing>(API_ENDPOINTS.admin.pricingRuleCountryPricing(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  updateCountryPricing: (countryPricingId: string, payload: UpdateCountryPricingPayload) =>
    apiRequest<SettingsCountryPricing>(
      API_ENDPOINTS.admin.pricingRuleCountryPricingRule(countryPricingId),
      {
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      }
    ),
  archiveCountryPricing: (countryPricingId: string) =>
    apiRequest<{ id: string; status: 'archived' }>(
      API_ENDPOINTS.admin.pricingRuleCountryPricingArchive(countryPricingId),
      { method: 'POST' }
    ),
  createPriceOverride: (payload: PriceOverridePayload) =>
    apiRequest<SettingsPriceOverride>(API_ENDPOINTS.admin.pricingRulePriceOverrides(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  updatePriceOverride: (overrideId: string, payload: UpdatePriceOverridePayload) =>
    apiRequest<SettingsPriceOverride>(API_ENDPOINTS.admin.pricingRulePriceOverride(overrideId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  archivePriceOverride: (overrideId: string) =>
    apiRequest<{ id: string; status: 'archived' }>(
      API_ENDPOINTS.admin.pricingRulePriceOverrideArchive(overrideId),
      { method: 'POST' }
    ),
  updateInvoiceSettings: (payload: UpdateInvoiceSettingsPayload) =>
    apiRequest<InvoiceSettings>(API_ENDPOINTS.admin.invoiceSettings(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  updatePlatformSetting: (key: string, payload: UpdatePlatformSettingPayload) =>
    apiRequest<PlatformSetting>(API_ENDPOINTS.admin.platformSetting(key), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  getTasksWorkspace: () =>
    apiRequest<TasksWorkspaceResponse>(API_ENDPOINTS.admin.tasksWorkspace()),
  createMessageThread: (payload: {
    clientId: string;
    confirmDuplicateGeneral?: boolean;
    content: string;
    matterId?: string;
  }) =>
    apiRequest<CreateMessageThreadResponse>(API_ENDPOINTS.admin.messageThreads(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  listClients: (params: { limit?: number; offset?: number; search?: string } = {}) =>
    apiRequest<ClientsListResponse>(
      withQuery(API_ENDPOINTS.admin.clients(), {
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
        search: params.search,
      })
    ),
  listMatters: (params: { limit?: number; offset?: number; search?: string } = {}) =>
    apiRequest<MattersListResponse>(
      withQuery(API_ENDPOINTS.admin.matters(), {
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
        search: params.search,
      })
    ),
  markNotificationRead: (notificationId: string) =>
    apiRequest<{ status: 'read' }>(API_ENDPOINTS.admin.notificationRead(notificationId), {
      method: 'POST',
    }),
  dismissNotification: (notificationId: string) =>
    apiRequest<{ status: 'dismissed' }>(API_ENDPOINTS.admin.notificationDismiss(notificationId), {
      method: 'POST',
    }),
  processReminders: () =>
    apiRequest<ReminderProcessResponse>(API_ENDPOINTS.admin.processReminders(), {
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  retryReminder: (reminderId: string) =>
    apiRequest<ReminderRetryResponse>(API_ENDPOINTS.admin.reminderRetry(reminderId), {
      method: 'POST',
    }),
  markThreadRead: (threadId: string) =>
    apiRequest<{ status: 'read' }>(API_ENDPOINTS.admin.messageRead(threadId), {
      method: 'POST',
    }),
  archiveThread: (threadId: string) =>
    apiRequest<{ status: 'archived' }>(API_ENDPOINTS.admin.messageArchive(threadId), {
      method: 'POST',
    }),
  replyToThread: (
    threadId: string,
    payload: { content: string; visibleToClient?: boolean }
  ) =>
    apiRequest<{ status: 'created' }>(API_ENDPOINTS.admin.replyToThread(threadId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  approveRequest: (requestId: string, payload: { note?: string } = {}) =>
    apiRequest<AdminRequestDecisionResponse>(API_ENDPOINTS.admin.requestApprove(requestId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  convertRequest: (requestId: string, payload: { note?: string } = {}) =>
    apiRequest<AdminRequestDecisionResponse>(API_ENDPOINTS.admin.requestConvert(requestId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  declineRequest: (requestId: string, payload: { note?: string } = {}) =>
    apiRequest<AdminRequestDecisionResponse>(API_ENDPOINTS.admin.requestDecline(requestId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  requestInformation: (requestId: string, payload: { note: string }) =>
    apiRequest<AdminRequestDecisionResponse>(API_ENDPOINTS.admin.requestInformation(requestId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  search: (query: string) =>
    apiRequest<SearchResultsResponse>(
      withQuery(API_ENDPOINTS.admin.search(), {
        q: query,
      })
    ),
  sendInvoice: (invoiceId: string) =>
    apiRequest<{
      emailDeliveryStatus?: 'failed' | 'manual' | 'sent';
      invoiceId: string;
      status: 'reminder_sent' | 'sent';
    }>(
      API_ENDPOINTS.admin.sendInvoice(invoiceId),
      {
        idempotency: {
          identity: createIdempotencyIdentity('admin-invoice-send', [invoiceId]),
          ttlMs: FORM_IDEMPOTENCY_TTL_MS,
        },
        method: 'POST',
      }
    ),
  buildInvoiceDownloadUrl: (invoiceId: string) => API_ENDPOINTS.admin.invoiceDownload(invoiceId),
  downloadInvoicePdf: async (invoiceId: string) => {
    const { blob, fileName } = await fetchBlob(
      API_ENDPOINTS.admin.invoiceDownload(invoiceId),
      `global-lmg-invoice-${invoiceId}.pdf`
    );
    downloadBlob(blob, fileName);
  },
  fetchInvoicePdfPreview: async (invoiceId: string) =>
    fetchBlob(API_ENDPOINTS.admin.invoiceDownload(invoiceId), `global-lmg-invoice-${invoiceId}.pdf`),
  uploadInvoicePdfTemplate: (payload: InvoicePdfTemplateUploadPayload) =>
    apiRequest<{ template: InvoicePdfTemplate | null }>(API_ENDPOINTS.admin.invoicePdfTemplates(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  updateInvoicePdfTemplate: (templateId: string, payload: InvoicePdfTemplateUpdatePayload) =>
    apiRequest<{ template: InvoicePdfTemplate | null }>(API_ENDPOINTS.admin.invoicePdfTemplate(templateId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  archiveInvoicePdfTemplate: (templateId: string) =>
    apiRequest<{ archived: true; templateId: string }>(
      API_ENDPOINTS.admin.invoicePdfTemplateArchive(templateId),
      { method: 'POST' }
    ),
  saveMatterPackageDraft: (
    matterId: string,
    payload: {
      packages: Array<{
        description?: string;
        displayOrder?: number;
        featurePoints?: string[];
        id?: string;
        isRecommended?: boolean;
        name: string;
        price: number;
        serviceCodes?: string[];
      }>;
      proposalVersion?: number;
    }
  ) =>
    apiRequest<MatterPackageProposalsResponse>(API_ENDPOINTS.admin.matterPackageDraft(matterId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    }),
  publishMatterProposal: (
    matterId: string,
    payload: { note?: string; proposalVersion: number }
  ) =>
    apiRequest<MatterPackageProposalsResponse>(API_ENDPOINTS.admin.matterPackagePublish(matterId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  overrideMatterPackageSelection: (
    matterId: string,
    payload: { matterPackageId: string; reasonText: string }
  ) =>
    apiRequest<{ generatedInvoiceId: string; status: 'updated'; workspace: MatterPackageProposalsResponse }>(
      API_ENDPOINTS.admin.matterPackageOverride(matterId),
      {
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }
    ),
  archiveMatterProposal: (matterId: string, proposalVersion: number) =>
    apiRequest<MatterPackageProposalsResponse>(
      API_ENDPOINTS.admin.matterPackageArchive(matterId, proposalVersion),
      {
        method: 'POST',
      }
    ),
  updateDocumentControls: (
    documentId: string,
    payload: { reviewState: 'reviewed' | 'unreviewed'; visibility: 'client' | 'internal' }
  ) =>
    apiRequest<{ status: 'updated' }>(API_ENDPOINTS.admin.documentControls(documentId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  buildDocumentDownloadUrl: (documentId: string) => API_ENDPOINTS.admin.documentDownload(documentId),
  buildDocumentPreviewUrl: (documentId: string) => API_ENDPOINTS.admin.documentPreview(documentId),
  buildReportDrilldownExportUrl: (kind: ReportDrilldownKind) =>
    API_ENDPOINTS.admin.reportDrilldownExport(kind),
  downloadReportDrilldownCsv: async (kind: ReportDrilldownKind) => {
    const fallbackName = `global-lmg-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    const response = await fetchWithTimeout(API_ENDPOINTS.admin.reportDrilldownExport(kind), {
      credentials: 'include',
    }, API_DOWNLOAD_TIMEOUT_MS);

    if (!response.ok) {
      let errorCode = 'csv_export_failed';
      let errorMessage = `CSV export failed with status ${response.status}`;

      try {
        const errorBody = (await response.json()) as { error?: string; message?: string };
        errorCode = errorBody.error || errorCode;
        errorMessage = errorBody.message || errorMessage;
      } catch {
        // Keep the status-based message.
      }

      throw new ApiRequestError(errorCode, errorMessage);
    }

    const fileName = getAttachmentFileName(response.headers.get('content-disposition'), fallbackName);
    downloadBlob(await response.blob(), fileName);
    return { fileName };
  },
  uploadDocument: async (payload: {
    categoryCode?: string;
    file: File;
    matterId: string;
    reviewState: 'reviewed' | 'unreviewed';
    visibility: 'client' | 'internal';
  }) => {
    const { checksumSha256, content } = await computeFileSha256(payload.file);

    return apiRequest<DocumentUploadResponse>(
      withQuery(API_ENDPOINTS.admin.uploadDocument(), {
        categoryCode: payload.categoryCode,
        checksumSha256,
        fileName: payload.file.name,
        matterId: payload.matterId,
        mimeType: payload.file.type || 'application/octet-stream',
        reviewState: payload.reviewState,
        visibility: payload.visibility,
      }),
      {
        body: content,
        headers: { 'content-type': 'application/octet-stream' },
        idempotency: {
          identity: createIdempotencyIdentity('admin-document-upload', [
            payload.matterId,
            payload.file.name,
            payload.file.size,
            checksumSha256,
            payload.visibility,
            payload.reviewState,
            payload.categoryCode ?? '',
          ]),
          ttlMs: FORM_IDEMPOTENCY_TTL_MS,
        },
        method: 'POST',
        timeoutMs: API_DOWNLOAD_TIMEOUT_MS,
      }
    );
  },
  uploadDocumentVersion: async (
    documentId: string,
    payload: {
      file: File;
      reviewState: 'reviewed' | 'unreviewed';
    }
  ) => {
    const { checksumSha256, content } = await computeFileSha256(payload.file);

    return apiRequest<DocumentUploadResponse>(
      withQuery(API_ENDPOINTS.admin.documentVersionUpload(documentId), {
        checksumSha256,
        fileName: payload.file.name,
        mimeType: payload.file.type || 'application/octet-stream',
        reviewState: payload.reviewState,
      }),
      {
        body: content,
        headers: { 'content-type': 'application/octet-stream' },
        idempotency: {
          identity: createIdempotencyIdentity('admin-document-version-upload', [
            documentId,
            payload.file.name,
            payload.file.size,
            checksumSha256,
            payload.reviewState,
          ]),
          ttlMs: FORM_IDEMPOTENCY_TTL_MS,
        },
        method: 'POST',
        timeoutMs: API_DOWNLOAD_TIMEOUT_MS,
      }
    );
  },
  rescanDocument: (documentId: string) =>
    apiRequest<{ provider: string; scanStatus: string; status: 'rescanned' }>(
      API_ENDPOINTS.admin.documentScan(documentId),
      {
        method: 'POST',
      }
    ),
  updateMatterDetails: (
    matterId: string,
    payload: {
      issueSummary?: string;
      operationalStatusCode?: string;
      priorityCode?: string;
      quotedTotalAmount?: number;
      selectedServices?: string[];
    }
  ) =>
    apiRequest<{ status: 'updated' }>(API_ENDPOINTS.admin.matterDetails(matterId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  updateMatterStage: (
    matterId: string,
    payload: {
      changeNote?: string;
      operationalStatusCode?: string;
      stageCode: string;
      visibleToClient?: boolean;
    }
  ) =>
    apiRequest<{ status: 'updated' }>(API_ENDPOINTS.admin.matterStage(matterId), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
};
